import { refine, refineForLLM, toTextDocument } from "$lib/shared/ocrparser";
import type { TaskContext } from '$lib/server/taskManager';
import { generateText } from './ai/index';

export async function extractInvoiceData(ocrData, tracking?: TaskContext)
{
    return extractInvoiceDataGroq(ocrData, tracking);
}


// https://www.npmjs.com/package/groq-sdk
async function extractInvoiceDataGroq(ocrData, tracking?: TaskContext)
{
    const prompt = `From the document (invoice or receipt) below, extract data and put it in this exact JSON structure:\n` +
        '```json\n{ "supplier": "string", "items": [ { "description": "string", "quantity": "number", "price": "number", "vat": "number" } ], "total": "string", "totalIncTaxes": "string", "date": "string", "invoiceNo": "string", "paymentMethod": "string" }\n```\n' +
        `CRITICAL: 'supplier', 'total', 'totalIncTaxes', 'date', 'invoiceNo', and 'paymentMethod' MUST be flat, primitive strings or numbers. DO NOT return nested objects for these fields.\n` +
        `If you see obvious typos, correct them. ` + 
        `Make sure numbers are copied verbatim. ` +
        // `Do not add products which has description as 'subtotal' or similar things that are not products. ` + 
        `If a field cannot be located, set the value to null, e.g.: description: null. ` +
        `Be brief and concise. ` +
        `Do not give me code. ` + 
        `Do not change any numbers. Use them verbatim. ` +
        `I only need the new JSON data, nothing else. `+
        `Do not give me an explanation. `
        ;

    const refined = toTextDocument(ocrData);

    try {
        const jsonSchema = { "type": "object", "properties": { "supplier": {"type": "string"}, "items": { "type": "array", "items": { "type": "object", "properties": { "description": {"type":"string"}, "quantity": {"type":"number"}, "price": {"type":"number"}, "vat": {"type":"number"} } } }, "total": {"type":"string"}, "totalIncTaxes": {"type":"string"}, "date": {"type":"string"}, "invoiceNo": {"type":"string"}, "paymentMethod": {"type":"string"} } };
            const resText = await generateText('Please try to provide useful, helpful and actionable answers. If user asks for JSON, give only JSON.', prompt + "\n\n" + JSON.stringify(refined), true, jsonSchema, 'Invoice Extraction', tracking, 'PARSER');
        return resText;
    } catch(ex) {
        console.error("Error running Invoice Extraction:", ex);
        return null;
    }
}


// Using Groq because free, limit to 8000 character input tho...
export async function summarizeWebpageExtract(extract, tracking?: TaskContext)
{
    const prompt = `Extract the core value of this document into an executive summary. Your response MUST begin immediately with the facts. NEVER begin with introductory filler like 'Here is the summary' or 'TLDR'. Focus on actionable data, specifications, or primary arguments. Be dense and comprehensive. But give some air between sentences.
Say what product it is about.
Leave out:
- user-generated content such as comments
- navigation elements
- sale/stock information
- reviews
- never give me JSON, I want plain markdown
and other irrelevant (to the product or guide) stuff that you might find on a webpage.`;

    try {
            const resText = await generateText('You are a helpful assistant. Please provide brief, actionable summaries in plain text.', prompt + "\n\n" + extract.substring(0, 7500), false, undefined, 'Web Summary', tracking, 'SUMMARY');
        return resText;
    } catch(ex) {
        console.error("Error running Web Summary:", ex);
        return null;
    }
}

/*
Input:
Example 1 : "MB102 Breadboard Power Supply Module 3.3V 5V Solderless Breadboard Voltage Regulator for Arduino Diy Kit"
Example 2 : "HiLetgo power supply for prototype board PCB Universal Breadboard 5V/3.3V output"
*/
export async function getProductFromReverseImageSearch(searchResults, tracking?: TaskContext)
{

    const prompt = `Below is a list of examples of titles of product pages. They all describe the same product. 
Give me one full name of the product (get rid of all the fluff that is just sales tactics). 
Give me the result as JSON like this (if you cannot find one product, put the explanation for why in a comment field IN the JSON):
{ "productName": ..., "productDescription": ... }`;

    // https://docs.together.ai/docs/json-mode
    try {
        const jsonSchema = { "type": "object", "properties": { "productName": {"type": "string"}, "productDescription": {"type": "string"}, "comment": {"type": "string"} }, "required": ["productName", "productDescription"] };
            const resText = await generateText('Please try to provide useful, helpful and actionable answers. If user asks for JSON, give only JSON.', prompt + "\n\n" + searchResults, true, jsonSchema, 'Reverse Search LLM Parsing', tracking, 'PARSER');
        return resText;

    } catch(ex) {
        console.error("Error running Reverse Search LLM Parsing:", ex);
        return null;
    }
}