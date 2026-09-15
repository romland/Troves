import { getProductFromReverseImageSearch } from "./llm";
import { reverseImageSearch } from "./reverseimagesearch";
import { spawn } from 'child_process'
import { env } from '$env/dynamic/private';
import { guessProductDetails } from "./vision-classification";


/*
TODO:
- This is now also called by 'editing' a product -- need some flag for that
*/
export async function autoFill(localFilePath)
{
    // 1. Primary: Fast local Gemini vision call
    try {
        const geminiResult = await guessProductDetails(localFilePath);
        if (geminiResult?.title) {
            console.log("autoFill(): Gemini success:", geminiResult);
            return geminiResult;
        }
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        console.warn("Tier-One autoFill failed, falling back to reverse search:", message);
    }

    // 2. Fallback: Google Reverse Image Search
    try {
        const uniqueName = "" + process.hrtime.bigint();
        const remotePath = env.SCP_THUMBNAIL_STORAGE + uniqueName;
        await scp(localFilePath, remotePath);
        console.log('File successfully copied:', localFilePath, remotePath);

        const titleDesc = await getNameDescription(env.SCP_THUMBNAIL_STORAGE_WEBPATH + uniqueName);
        const ob = JSON.parse(titleDesc);

        return {
            title: ob.productName,
            description: ob.productDescription,
        }
    } catch (err) {
        console.error(`autoFill fallback Error: ${err}`);
        return {};
    }
}


// Google Image Reverse Search
async function getNameDescription(thumbUrl)
{
    const pageTitles = await reverseImageSearch(thumbUrl);
    let pageTitlesStr = "";
    for(let i = 0; i < pageTitles.length; i++) {
        pageTitlesStr += `Example ${i + 1}: ${pageTitles[i]}\n`;
    }

    console.log(pageTitlesStr);
    const llmResult = await getProductFromReverseImageSearch(pageTitlesStr)

    console.log("Product name is then: " + llmResult);
    return llmResult;
}

/**
 * To make thumbnail accessible to non-whitelisted server (i.e. Google Image Search)
 */
function scp(source, destination)
{
    return new Promise((resolve, reject) => {

        const scpProcess = spawn('scp', ['-i', '~/.ssh/id_rsa', source, destination]);

        scpProcess.stdout.on('data', (data) => {
            console.log(`stdout: ${data}`);
        });

        scpProcess.stderr.on('data', (data) => {
            console.error(`stderr: ${data}`);
            reject(data);
        });

        scpProcess.on('close', (code) => {
            if (code === 0) {
                console.log(`File copied successfully`);
                resolve(null);
            } else {
                reject(`File copy failed with code ${code}`);
            }
        });
    });
}
