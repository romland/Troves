/**
 * @name Voice Notebook Dictation
 * @description Allows you to dictate notes directly into your Trove's notebook using voice search. Just say "Remind me to buy eggs" or "Note to self the filter was changed".
 * @author Troves Community
 * @version 1.0.0
 * @updated 2026-09-23
 * @github https://github.com/romland/troves
 */
export default function register({ registerVoiceIntent, db, logActivity }) {
    registerVoiceIntent(
        {
            id: 'dictate-note',
            // Regex matches variations of "note to self", "remind me to", "add to shopping list", etc.
            regex: /^(?:remind me to buy|add to shopping list|note to self|write down|remember to|log that)\s+(.+)$/i
        },
        async (match, { inventoryId, user }) => {
            const content = match[1].trim();
            let category = 'idea';
            
            // Route to the 'to buy' tab if they used purchasing language
            const fullCommand = match[0].toLowerCase();
            if (fullCommand.includes('buy') || fullCommand.includes('shopping')) {
                category = 'to buy';
            }

            // Save to the database directly
            await db.timelineNote.create({
                data: {
                    content: content,
                    category: category,
                    inventoryId: inventoryId,
                    authorId: user.id
                }
            });

            // Make sure we follow the absolute transparency rule!
            logActivity(null, 'Voice Dictation', `Saved note to category '${category}' via Voice Search.`);

            return {
                query: match[0],
                // This is spoken out loud to the user
                spokenReply: `I have saved that to your notebook.`,
                // Send them to the timeline to visually confirm it
                route: '/timeline'
            };
        }
    );
}