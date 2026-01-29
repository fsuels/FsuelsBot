/**
 * Repair hash chain - re-link entire chain from chain_init
 * Handles interleaved hashed/unhashed events by rebuilding links
 */

const fs = require('fs');
const { computeHash } = require('./hash-chain.cjs');

const EVENTS_FILE = process.argv[2] || 'memory/events.jsonl';

function repairChain(filePath) {
    if (!fs.existsSync(filePath)) {
        console.error('File not found:', filePath);
        process.exit(1);
    }
    
    const content = fs.readFileSync(filePath, 'utf8').trim();
    const lines = content.split('\n');
    const newLines = [];
    
    let chainStarted = false;
    let lastHash = null;
    let repaired = 0;
    let relinked = 0;
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) continue;
        
        let event;
        try {
            event = JSON.parse(line);
        } catch (e) {
            newLines.push(line);
            continue;
        }
        
        // Check for chain init
        if (event.type === 'chain_init' && event.hash) {
            chainStarted = true;
            lastHash = event.hash;
            newLines.push(line);
            console.log(`Chain init at line ${i+1}, hash: ${lastHash}`);
            continue;
        }
        
        // Before chain started - keep as legacy
        if (!chainStarted) {
            newLines.push(line);
            continue;
        }
        
        // After chain started - ensure proper linking
        const needsHash = !event.hash;
        const needsRelink = event.prevHash !== lastHash;
        
        if (needsHash || needsRelink) {
            // Update prevHash to link to previous event
            event.prevHash = lastHash;
            
            // Recompute hash
            delete event.hash;
            event.hash = computeHash(event);
            
            if (needsHash) {
                repaired++;
                console.log(`Line ${i+1}: Added hash to ${event.id}`);
            } else {
                relinked++;
                console.log(`Line ${i+1}: Relinked ${event.id}`);
            }
        }
        
        lastHash = event.hash;
        newLines.push(JSON.stringify(event));
    }
    
    // Write repaired file
    fs.writeFileSync(filePath, newLines.join('\n') + '\n');
    console.log(`\n✅ Repaired ${repaired} events, relinked ${relinked} events`);
    console.log(`Total chain now has ${newLines.filter(l => l.includes('"hash"')).length} hashed events`);
    return repaired + relinked;
}

const count = repairChain(EVENTS_FILE);
process.exit(count >= 0 ? 0 : 1);
