
import type { NextFunction, Request, Response } from "express";
import { createSupabaseClient } from "./client";
import { prisma } from "./db";

const client = createSupabaseClient();

export async function middleware(
    req: Request,
    res: Response,
    next: NextFunction
) {
    try {
        const token = req.headers.authorization;

        if (!token) {
            return res.status(401).json({
                message: "Authorization token is required",
            });
        }

        const data = await client.auth.getUser(token);
        const user = data.data.user;

        if (!user || !user.email) {
            return res.status(403).json({
                message: "Incorrect input",
            });
        }

        const userId = user.id;


        await prisma.user.upsert({
            where: {
                supabaseId: userId,
            },
            update: {
                email: user.email,
            },
            create: {
                supabaseId: userId,
                email: user.email,
                provider:
                    user.user_metadata?.provider === "google"
                        ? "Google"
                        : "Github",
                name: user.user_metadata?.full_name ?? "",
            },
        });


        req.userId = userId;

        next();

    } catch (error) {
        console.error("Authentication error:", error);

        return res.status(401).json({
            message: "Unauthorized",
        });
    }
}
