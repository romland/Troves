// See https://kit.svelte.dev/docs/types#app
// for information about these interfaces
// and what to do when importing types

import { PrismaClient } from "@prisma/client";

declare global {
	namespace App {
		// interface Error {}
        interface Locals {
            user: {
                id: number;
                username: string;
                name: string;
                email: string | null;
                avatar: string | null;
                isAdmin: boolean;
                preferences: string | null;
                canCreateInventories: boolean;
            } | null;
            activeInventoryId: number | null;
            role: string;
            largeFont?: boolean;
            activeSort?: string;
            activeViewMode?: string;
            activeAddMode?: string;
        }
        // interface PageData {}
        // interface PageState {}
        // interface Platform {}
	}

	var db: PrismaClient;
}

declare module 'virtual:pwa-info' {
	export const pwaInfo: {
		webManifest: { linkTag: string };
	} | undefined;
}

declare module '@lokesh.dhakar/quantize/dist/index.mjs' {
    const quantize: any;
    export default quantize;
}

export {};