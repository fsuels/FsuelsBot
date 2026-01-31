// Fix navigation across all Ghost Broker pages
const fs = require('fs');
const path = require('path');

const websiteDir = path.join(__dirname, '../website');

// Standard navigation HTML
const desktopNav = `<nav class="nav-links desktop-nav">
                <a href="hire.html">👤 Hire Agent</a>
                <a href="register.html">📝 List Agent</a>
                <a href="directory.html">📂 Directory</a>
                <a href="coop.html">🤝 Co-ops</a>
                <a href="blog.html">📰 Blog</a>
                <a href="pay.html" class="btn-nav">💳 Pay</a>
            </nav>`;

const mobileNav = `<nav class="mobile-nav" id="mobileNav">
            <a href="index.html">🏠 Home</a>
            <a href="hire.html">👤 Hire an Agent</a>
            <a href="register.html">📝 List Your Agent</a>
            <a href="directory.html">📂 Agent Directory</a>
            <a href="coop.html">🤝 Agent Co-ops</a>
            <a href="pay.html">💳 Make Payment</a>
            <a href="post-job.html">📋 Post a Job</a>
            <a href="blog.html">📰 Blog</a>
            <a href="leaderboard.html">🏆 Leaderboard</a>
            <a href="affiliate.html">💰 Affiliates</a>
        </nav>`;

const hamburgerBtn = `<button class="hamburger" id="hamburger" aria-label="Menu">
                <span></span>
                <span></span>
                <span></span>
            </button>`;

const hamburgerScript = `
    <script>
        // Mobile menu toggle
        const hamburger = document.getElementById('hamburger');
        const mobileNav = document.getElementById('mobileNav');
        if (hamburger && mobileNav) {
            hamburger.addEventListener('click', () => {
                hamburger.classList.toggle('active');
                mobileNav.classList.toggle('open');
            });
        }
    </script>`;

const hamburgerStyles = `
        /* Mobile Navigation Styles */
        .hamburger {
            display: none;
            flex-direction: column;
            gap: 5px;
            background: none;
            border: none;
            cursor: pointer;
            padding: 10px;
        }
        .hamburger span {
            display: block;
            width: 25px;
            height: 3px;
            background: var(--text-primary, #e0e0e0);
            transition: all 0.3s ease;
        }
        .hamburger.active span:nth-child(1) { transform: rotate(45deg) translate(5px, 5px); }
        .hamburger.active span:nth-child(2) { opacity: 0; }
        .hamburger.active span:nth-child(3) { transform: rotate(-45deg) translate(7px, -6px); }
        
        .mobile-nav {
            display: none;
            flex-direction: column;
            position: fixed;
            top: 70px;
            left: 0;
            right: 0;
            background: var(--bg-secondary, #1a1a2e);
            padding: 20px;
            gap: 15px;
            z-index: 999;
            border-bottom: 1px solid var(--border, #333);
        }
        .mobile-nav.open { display: flex; }
        .mobile-nav a { padding: 10px 0; color: var(--text-primary, #e0e0e0); text-decoration: none; }
        .mobile-nav a:hover { color: var(--accent, #00d4ff); }
        
        @media (max-width: 768px) {
            .hamburger { display: flex; }
            .desktop-nav { display: none !important; }
        }`;

// Pages to update
const pages = fs.readdirSync(websiteDir).filter(f => f.endsWith('.html'));

let updated = 0;
let skipped = 0;

pages.forEach(page => {
    const filePath = path.join(websiteDir, page);
    let content = fs.readFileSync(filePath, 'utf8');
    let modified = false;
    
    // Skip if already has proper mobile nav
    if (content.includes('mobile-nav') && content.includes('leaderboard.html') && content.includes('affiliate.html')) {
        console.log(`✓ ${page} - already complete`);
        skipped++;
        return;
    }
    
    // Check if page has a header/nav section
    if (!content.includes('<header') && !content.includes('<nav')) {
        console.log(`⚠ ${page} - no header/nav found, skipping`);
        skipped++;
        return;
    }
    
    // Add hamburger styles if missing
    if (!content.includes('.hamburger {')) {
        content = content.replace('</style>', hamburgerStyles + '\n    </style>');
        modified = true;
    }
    
    // Add hamburger button if missing
    if (!content.includes('hamburger') && content.includes('</header>')) {
        // Find the header closing and add hamburger before nav-links
        const navMatch = content.match(/<nav class="nav-links[^"]*">/);
        if (navMatch) {
            content = content.replace(navMatch[0], hamburgerBtn + '\n            ' + navMatch[0]);
            modified = true;
        }
    }
    
    // Update desktop nav class
    if (content.includes('class="nav-links"') && !content.includes('class="nav-links desktop-nav"')) {
        content = content.replace('class="nav-links"', 'class="nav-links desktop-nav"');
        modified = true;
    }
    
    // Add mobile nav if missing
    if (!content.includes('mobile-nav')) {
        // Add after desktop nav closing
        const navClose = content.indexOf('</nav>');
        if (navClose > -1) {
            content = content.slice(0, navClose + 6) + '\n        ' + mobileNav + content.slice(navClose + 6);
            modified = true;
        }
    }
    
    // Update existing mobile nav to include leaderboard/affiliate
    if (content.includes('mobile-nav') && !content.includes('leaderboard.html')) {
        content = content.replace(
            /<a href="blog\.html">[^<]*Blog<\/a>\s*<\/nav>/,
            `<a href="blog.html">📰 Blog</a>
            <a href="leaderboard.html">🏆 Leaderboard</a>
            <a href="affiliate.html">💰 Affiliates</a>
        </nav>`
        );
        modified = true;
    }
    
    // Add hamburger script if missing
    if (!content.includes("getElementById('hamburger')") && content.includes('hamburger')) {
        content = content.replace('</body>', hamburgerScript + '\n</body>');
        modified = true;
    }
    
    // Set active class based on current page
    const pageName = page.replace('.html', '');
    if (content.includes(`href="${page}"`) && !content.includes(`href="${page}" class="active"`)) {
        content = content.replace(new RegExp(`href="${page}"(?!.*class)`, 'g'), `href="${page}" class="active"`);
        modified = true;
    }
    
    if (modified) {
        fs.writeFileSync(filePath, content);
        console.log(`✅ ${page} - updated`);
        updated++;
    } else {
        console.log(`- ${page} - no changes needed`);
        skipped++;
    }
});

console.log(`\n📊 Summary: ${updated} updated, ${skipped} skipped`);
