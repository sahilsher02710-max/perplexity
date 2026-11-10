import "dotenv/config";
import cors from "cors";
import express from "express";
import { tavily } from "@tavily/core";
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";
const app = express();

// Allow requests from frontend
app.use(cors());

app.use(express.json());

import { PROMPT_TEMPLATE, SYSTEM_PROMPT } from "./prompt";
import { middleware } from "./middleware";
const client = tavily({ apiKey: process.env.TAVILY_API_KEY});


app.use(express.json());


app.post("/signup",async (req,res) => {
    
})

app.post("/signin",async (req,res) => {

})

// past conversations get
app.get("/conversations",middleware ,async (req,res) =>{
    res.json({
            userId: req.userId
    })
})

// past conversation get
app.get("/conversation/:conversationId",middleware ,async (req,res) =>{

})

 
app.post("/perplexity_ask", middleware ,async (req, res) => {
    try {
        // Step 1 - Get the query from the user
        const query = req.body.query;

        if (!query || typeof query !== "string") {
            res.status(400).json({
                error: "Query is required",
            });
            return;
        }

        // Step 2 - Check user access / credits (TODO)

        // Step 3 - Check existing indexed searches (TODO)

        // Step 4 - Web search to gather resources
        const webSearchResponse = await client.search(query, {
            searchDepth: "advanced",
        });

        const webSearchResult = webSearchResponse.results;

        // Step 5 - Create the prompt
        const prompt = PROMPT_TEMPLATE
            .replace(
                "{{WEB_SEARCH_RESULTS}}",
                JSON.stringify(webSearchResult)
            )
            .replace("{{USER_QUERY}}", query);

        // Step 6 - Hit the LLM and stream the response
        const result = streamText({
            model: openai("gpt-5.4"),
            prompt: prompt,
            system: SYSTEM_PROMPT,
        });

        // Set response headers
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.setHeader("Transfer-Encoding", "chunked");

        // Stream the AI response
        for await (const textPart of result.textStream) {
            res.write(textPart);
        }

        // Step 7 - Send the sources
        res.write("\n\n---------------- SOURCES ----------------\n");

        webSearchResult.forEach((result) => {
            res.write(JSON.stringify(result) + "\n");
        });

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


app.post("/purplexity_ask/follow_up",middleware ,async(req,res) => {

    // Step 1 - get the existinf chat from the db ,  
    // Step 2 - Forward the full history to the LLM 
    // STEP 2.5 - TODO : Do context engineering here   ,  
    // Step 3 - Stream the response to the user.     ,  
})

app.listen(3100, () => {
    console.log("Server running on http://localhost:3100");
});
