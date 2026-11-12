import "dotenv/config";
import cors from "cors";
import express from "express";
import { tavily } from "@tavily/core";
import { streamText, type ModelMessage } from "ai";
import { openai } from "@ai-sdk/openai";
const app = express();

// Allow requests from frontend
app.use(cors());

app.use(express.json());

import { PROMPT_TEMPLATE, SYSTEM_PROMPT } from "./prompt";
import { middleware } from "./middleware";
import { prisma } from "./db";
const client = tavily({ apiKey: process.env.TAVILY_API_KEY });



// 1. GET /conversations — list all conversations for the user

app.get("/conversations", middleware, async (req, res) => {
    try {
        const user = await prisma.user.findUnique({
            where: { supabaseId: req.userId! },
        });

        if (!user) {
            res.status(404).json({ error: "User not found" });
            return;
        }

        const conversations = await prisma.conversation.findMany({
            where: { userId: user.id },
            orderBy: { id: "desc" },
            select: {
                id: true,
                title: true,
                slug: true,
                messages: {
                    orderBy: { createdAt: "desc" },
                    take: 1,
                    select: {
                        content: true,
                        createdAt: true,
                    },
                },
            },
        });

        res.json({ conversations });
    } catch (error) {
        console.error("Error fetching conversations:", error);
        res.status(500).json({ error: "Something went wrong" });
    }
});

// 2. GET /conversation/:conversationId — get a single conversation with messages

app.get("/conversation/:conversationId", middleware, async (req, res) => {
    try {
        const user = await prisma.user.findUnique({
            where: { supabaseId: req.userId! },
        });

        if (!user) {
            res.status(404).json({ error: "User not found" });
            return;
        }

        const conversation = await prisma.conversation.findFirst({
            where: {
                id: req.params.conversationId as string,
                userId: user.id,
            },
            include: {
                messages: {
                    orderBy: { createdAt: "asc" },
                },
            },
        });

        if (!conversation) {
            res.status(404).json({ error: "Conversation not found" });
            return;
        }

        res.json({ conversation });
    } catch (error) {
        console.error("Error fetching conversation:", error);
        res.status(500).json({ error: "Something went wrong" });
    }
});

// 3. POST /perplexity_ask — new question (creates a new conversation)

app.post("/perplexity_ask", middleware, async (req, res) => {
    try {
        // Step 1 - Get the query from the user
        const query = req.body.query;

        if (!query || typeof query !== "string") {
            res.status(400).json({
                error: "Query is required",
            });
            return;
        }

        // Resolve the prisma user from supabaseId
        const user = await prisma.user.findUnique({
            where: { supabaseId: req.userId! },
        });

        if (!user) {
            res.status(404).json({ error: "User not found" });
            return;
        }

        // Step 2 - Web search to gather resources
        const webSearchResponse = await client.search(query, {
            searchDepth: "advanced",
        });

        const webSearchResult = webSearchResponse.results;

        // Step 3 - Create the prompt
        const prompt = PROMPT_TEMPLATE
            .replace(
                "{{WEB_SEARCH_RESULTS}}",
                JSON.stringify(webSearchResult)
            )
            .replace("{{USER_QUERY}}", query);

        // Step 4 - Hit the LLM and stream the response
        const result = streamText({
            model: openai("gpt-4o-mini"), // Check that your OPENAI_API_KEY in be/.env is valid
            prompt: prompt,
            system: SYSTEM_PROMPT,
            onError({ error }) {
                console.error("OpenAI Stream Error:", error);
            },
        });

        // Set response headers
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.setHeader("Transfer-Encoding", "chunked");

        // Collect the full assistant response while streaming
        let fullResponse = "";

        // Stream the AI response
        for await (const textPart of result.textStream) {
            res.write(textPart);
            fullResponse += textPart;
        }

        // Step 5 - Send the sources
        res.write("\n\n---------------- SOURCES ----------------\n");

        webSearchResult.forEach((result) => {
            res.write(JSON.stringify(result) + "\n");
        });

        // Step 6 - Create the slug from the query
        const slug = query
            .toLowerCase()
            .replace(/[^a-z0-9\s-]/g, "")
            .trim()
            .replace(/\s+/g, "-")
            .slice(0, 80);

        // Step 7 - Persist the conversation and messages to the DB
        const conversation = await prisma.conversation.create({
            data: {
                title: query.slice(0, 200),
                slug: slug,
                userId: user.id,
                messages: {
                    create: [
                        { content: query, role: "User" },
                        { content: fullResponse, role: "Assistant" },
                    ],
                },
            },
        });

        // Send the conversation ID so the frontend can use it for follow-ups
        res.write(
            "\n\n---------------- CONVERSATION ----------------\n" +
            JSON.stringify({ conversationId: conversation.id }) +
            "\n"
        );

        // Step 8 - Close the event stream
        res.end();

    } catch (error) {
        console.error("Error:", error);

        if (!res.headersSent) {
            res.status(500).json({
                error: "Something went wrong",
            });
        } else {
            res.end();
        }
    }
});

// 4. POST /purplexity_ask/follow_up — follow-up on an existing conversation

app.post("/purplexity_ask/follow_up", middleware, async (req, res) => {
    try {
        const { conversationId, query } = req.body;

        if (!conversationId || !query || typeof query !== "string") {
            res.status(400).json({
                error: "conversationId and query are required",
            });
            return;
        }

        // Resolve the prisma user from supabaseId
        const user = await prisma.user.findUnique({
            where: { supabaseId: req.userId! },
        });

        if (!user) {
            res.status(404).json({ error: "User not found" });
            return;
        }

        // Step 1 - Get the existing chat from the DB
        const conversation = await prisma.conversation.findFirst({
            where: {
                id: conversationId,
                userId: user.id,
            },
            include: {
                messages: {
                    orderBy: { createdAt: "asc" },
                },
            },
        });

        if (!conversation) {
            res.status(404).json({ error: "Conversation not found" });
            return;
        }

        // Step 2 - Do a fresh web search for the follow-up query
        const webSearchResponse = await client.search(query, {
            searchDepth: "advanced",
        });

        const webSearchResult = webSearchResponse.results;

        // Step 2.5 - Build the full message history for the LLM
        const history: ModelMessage[] = conversation.messages.map((msg) => ({
            role: msg.role === "User" ? ("user" as const) : ("assistant" as const),
            content: msg.content,
        }));

        // Add the new follow-up query with web search context
        const followUpPrompt = PROMPT_TEMPLATE
            .replace(
                "{{WEB_SEARCH_RESULTS}}",
                JSON.stringify(webSearchResult)
            )
            .replace("{{USER_QUERY}}", query);

        history.push({ role: "user", content: followUpPrompt });

        // Step 3 - Hit the LLM with the full history and stream the response
        const result = streamText({
            model: openai("gpt-4o-mini"), // Check that your OPENAI_API_KEY in be/.env is valid
            messages: history,
            system: SYSTEM_PROMPT,
            onError({ error }) {
                console.error("OpenAI Stream Error:", error);
            },
        });

        // Set response headers
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.setHeader("Transfer-Encoding", "chunked");

        // Collect the full assistant response while streaming
        let fullResponse = "";

        for await (const textPart of result.textStream) {
            res.write(textPart);
            fullResponse += textPart;
        }

        // Send the sources
        res.write("\n\n---------------- SOURCES ----------------\n");

        webSearchResult.forEach((result) => {
            res.write(JSON.stringify(result) + "\n");
        });

        // Step 4 - Persist the new messages to the DB
        await prisma.message.createMany({
            data: [
                {
                    content: query,
                    role: "User",
                    conversationId: conversation.id,
                },
                {
                    content: fullResponse,
                    role: "Assistant",
                    conversationId: conversation.id,
                },
            ],
        });

        // Close the event stream
        res.end();

    } catch (error) {
        console.error("Error:", error);

        if (!res.headersSent) {
            res.status(500).json({
                error: "Something went wrong",
            });
        } else {
            res.end();
        }
    }
});

app.listen(3100, () => {
    console.log("Server running on http://localhost:3100");
});
