import fs from 'fs';
import { analyzeImage } from '$lib/server/ai/index';
import { getImageMimeType } from '$lib/server/fsUtils';
import { createVisionOptimizedPass } from './imageEnhancer';
import type { TaskContext } from '$lib/server/taskManager';

export interface ContainerMapResult {
    isGrid: boolean;
    compartments: number[][][]; // Array of 4-point polygons
}

/**
 * Feeds a top-down photo of a container to the Vision model to map its internal compartments.
 */
export async function mapContainerCompartments(localFilePath: string, tracking?: TaskContext): Promise<ContainerMapResult | null> {
    // 1. Create a hyper-contrasted temporary pass so the AI can see the dark dividers
    const tempPath = localFilePath + '.opt.webp';
    const finalPathToRead = await createVisionOptimizedPass(localFilePath, tempPath);
    
    const fileBuffer = fs.readFileSync(finalPathToRead);
    const base64Data = fileBuffer.toString('base64');
    const mimeType = getImageMimeType(finalPathToRead);

    const promptText = `Analyze this top-down photo of a physical storage container (e.g., a drawer, shelf, tackle box, or gridfinity layout).
    Determine if this container is subdivided into distinct physical compartments, trays, or grid slots.
    If it is, extract a 4-point oriented bounding box (polygon) for the INNER usable area of EVERY single compartment.
    Return the 4 corners as [[x1,y1], [x2,y2], [x3,y3], [x4,y4]] normalized from 0 to 1000.
    Ensure you capture perspective skew (the boxes do not need to be perfectly rectangular).
    If there are no internal compartments (it's just a single open box or room), set isGrid to false.`;

    const jsonSchema = { 
        type: 'object', 
        properties: { 
            isGrid: { type: 'boolean' }, 
            compartments: { 
                type: 'array', 
                items: { 
                    type: 'array', 
                    items: { type: 'array', items: { type: 'number' } },
                    description: 'Exactly 4 points [[x,y], [x,y], [x,y], [x,y]] outlining the compartment.'
                } 
            } 
        }, 
        required: ['isGrid', 'compartments'] 
    };

    try {
        const rawText = await analyzeImage(promptText, mimeType, base64Data, true, jsonSchema, 'Container Compartment Mapping', tracking, 'MULTISCAN');
        return JSON.parse(rawText);
    } catch (e) {
        console.error("[Container Mapper] Failed to map compartments.", e);
        return null;
    } finally {
        // Clean up the deep-fried vision pass immediately
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    }
}