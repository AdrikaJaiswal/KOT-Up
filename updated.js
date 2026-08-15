// ==UserScript==
// @name         Swiggy Zomato Order Forwarder (Unit Expansion Build)
// @namespace    http://tampermonkey.net/
// @version      2.8.7
// @description  Expands multiplier unit detection to cups, plates, and pieces across Swiggy and Zomato.
// @author       Adrika
// @match        *://*.partner.swiggy.com/*
// @match        *://*.zomato.com/*
// @match        *://web.whatsapp.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-end
// ==/UserScript==

const STORAGE_KEY = "whatsapp_pending_order_msg";
const PROCESSED_ORDERS = new Set();

// =========================================================================
// 🍳 CORE SANITIZATION & DYNAMIC CACHE AGGREGATION ENGINE
// =========================================================================
function compileAndMergeItems(rawItemsList, isVyanjan) {
    const mergedMap = new Map();

    rawItemsList.forEach(item => {
        let cleanName = item.name.trim();
        let quantity = item.quantity;

        // Strip structural brackets, item pricing parameters, and formatting debris
        cleanName = cleanName
            .replace(/\[[^\]]*\]/g, '')
            .replace(/\([^\)]*\)/g, '')
            .replace(/₹\s*\d+(\.\d{2})?/g, '') // Strips prices with decimal balances completely
            .replace(/\s+/g, ' ')
            .trim();

        // Standardize raw string contents to cohesive Title Case
        cleanName = cleanName.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');

        // [BRAND CONTROLLER RULE]: Apply explicit global clubbing ONLY if this isn't a Vyanjan order
        if (!isVyanjan && /kachori|kochuri/i.test(cleanName)) {
            cleanName = "Kachori Sabzi";
        }

        if (mergedMap.has(cleanName)) {
            mergedMap.set(cleanName, mergedMap.get(cleanName) + quantity);
        } else {
            mergedMap.set(cleanName, quantity);
        }
    });

    const finalItems = [];
    mergedMap.forEach((qty, name) => {
        if (name.length > 1) {
            finalItems.push({ name: name, quantity: qty });
        }
    });
    return finalItems;
}

// =========================================================================
// 🟥 INTERFACE 1: ZOMATO MERCHANT PORTAL PARSER
// =========================================================================
function parseZomatoCard(card) {
    // Locate the sub-nested component element isolating the core numerical ID
    const idSpan = card.querySelector('div.css-16jdd3h span font-weight, [class*="sc-jzJRlG"]');
    if (!idSpan) return null;

    const orderId = idSpan.textContent.replace(/[^0-9]/g, '').trim();
    if (!orderId || orderId.length < 4 || PROCESSED_ORDERS.has(orderId)) return null;

    // BRAND LOOKUP: Scan the explicit Zomato title field element container for Vyanjan confirmation
    const brandHeader = card.querySelector('.css-1cyrfy9');
    const isVyanjan = brandHeader ? /vyanjan/i.test(brandHeader.textContent) : false;

    const rawItems = [];

    // Target ONLY the deep inner item lines to eliminate container double-scanning loops
    const itemRows = card.querySelectorAll('.css-68hfpx');

    itemRows.forEach(row => {
        const nameEl = row.querySelector('.css-1mcri0u');
        const qtyEl = row.querySelector('.css-11wxfyl');

        if (nameEl && qtyEl) {
            let mainQty = parseInt(qtyEl.textContent.replace(/[^0-9]/g, '').trim(), 10) || 1;
            let rawName = nameEl.textContent.trim();
            let multiplierFound = 1;

            // ZOMATO MULTIPLIER FORMAT A: Inline brackets/parentheses (pieces, pcs, cups, plates)
            const inlineMatch = rawName.match(/[\[\(](\d+)\s*(?:pieces?|pcs?|cups?|plates?)[\]\)]/i);

            // ZOMATO MULTIPLIER FORMAT B: Subscript quantity block
            const outerRowBlock = row.closest('.css-1gq83dh') || row.closest('.css-pnn23e') || row.parentElement?.parentElement;
            const subscriptEl = outerRowBlock ? outerRowBlock.querySelector('.css-dkoqby') : null;
            const subscriptMatch = subscriptEl ? subscriptEl.textContent.match(/Quantity:\s*(\d+)/i) : null;

            if (inlineMatch) {
                multiplierFound = parseInt(inlineMatch[1], 10);
            } else if (subscriptMatch) {
                multiplierFound = parseInt(subscriptMatch[1], 10);
            }

            let finalCalculatedQty = mainQty * multiplierFound;

            rawItems.push({ name: rawName, quantity: finalCalculatedQty });
        }
    });

    const finalMergedItems = compileAndMergeItems(rawItems, isVyanjan);
    return finalMergedItems.length > 0 ? { orderId, platform: 'zomato', items: finalMergedItems } : null;
}

// =========================================================================
// 🟧 INTERFACE 2: SWIGGY PARTNER DASHBOARD PARSER
// =========================================================================
function parseSwiggyCard(card) {
    const idEl = card.querySelector('[data-testid="last_4_digits_order_number"]');
    if (!idEl) return null;

    const orderId = idEl.textContent.replace(/[^0-9]/g, '').trim();
    if (!orderId || PROCESSED_ORDERS.has(orderId)) return null;

    // BRAND LOOKUP: Scan the complete card data text context block for Vyanjan identification flags
    const isVyanjan = /vyanjan/i.test(card.textContent);

    const rawItems = [];
    const nameElements = card.querySelectorAll('[data-testid="item_name"]');

    nameElements.forEach(nameEl => {
        // [SWIGGY GRID SAFEGUARD]: Trace upward until capturing BOTH left text and right multiplier boxes
        let rowContext = nameEl.parentElement;
        while (rowContext && !rowContext.textContent.includes('₹')) {
            rowContext = rowContext.parentElement;
        }
        if (!rowContext) {
            rowContext = nameEl.closest('.css-g5y9jx') || nameEl.parentElement?.parentElement;
        }

        if (rowContext) {
            // Flatten vertical line breaks to parse detached right-aligned containers smoothly
            const fullRowText = rowContext.textContent.replace(/\s+/g, ' ').trim();

            // SWIGGY MULTIPLIER FORMAT A: Remote alignment tracker metrics (e.g. "x 1", "x 2")
            const qtyMatch = fullRowText.match(/x\s*(\d+)/i) || fullRowText.match(/(\d+)\s*x/i);
            let mainQuantity = qtyMatch ? parseInt(qtyMatch[1], 10) : 1;

            let rawName = nameEl.textContent.trim();

            // SWIGGY MULTIPLIER FORMAT B: Inline parenthetical/bracket unit scales (e.g. "[2 Cups]", "(8 Pcs)")
            const inlineMatch = rawName.match(/[\[\(](\d+)\s*(?:pieces?|pcs?|cups?|plates?)[\]\)]/i);
            if (inlineMatch) {
                mainQuantity = mainQuantity * parseInt(inlineMatch[1], 10);
            }

            rawItems.push({ name: rawName, quantity: mainQuantity });
        }
    });

    const finalMergedItems = compileAndMergeItems(rawItems, isVyanjan);
    return finalMergedItems.length > 0 ? { orderId, platform: 'swiggy', items: finalMergedItems } : null;
}

// =========================================================================
// 🌐 UNIFIED RUNTIME DISTRIBUTOR LOOP
// =========================================================================
function scanDashboardLayout() {
    const isSwiggy = window.location.hostname.includes('swiggy');

    if (isSwiggy) {
        document.querySelectorAll('.css-g5y9jx').forEach(block => {
            if (block.querySelector('[data-testid="last_4_digits_order_number"]')) {
                if (block.offsetHeight > 50) {
                    const orderData = parseSwiggyCard(block);
                    if (orderData) dispatchToWhatsApp(orderData);
                }
            }
        });
    } else {
        document.querySelectorAll('.css-eeodfr').forEach(card => {
            // [QUEUE LOCK]: Only extract from active preparation pools; ignore transit flags
            if (card.textContent.includes('Order ready') && !card.textContent.includes('Delivering in')) {
                const orderData = parseZomatoCard(card);
                if (orderData) dispatchToWhatsApp(orderData);
            }
        });
    }
}

function dispatchToWhatsApp(orderData) {
    PROCESSED_ORDERS.add(orderData.orderId);

    const prefix = orderData.platform === 'swiggy' ? 'S' : 'Z';
    let msg = `${prefix}${orderData.orderId}\n`;

    orderData.items.forEach(item => {
        msg += `${item.quantity} ${item.name}\n`;
    });

    console.log(`%c[Forwarder] Processing Order Token Live:\n${msg.trim()}`, "color: #00ff00; font-weight: bold;");
    GM_setValue(STORAGE_KEY, msg.trim());
}

// =========================================================================
// 💬 WHATSAPP INJECTION DELIVERY SYSTEM
// =========================================================================
function handleWhatsAppInjection() {
    setInterval(() => {
        const pendingMsg = GM_getValue(STORAGE_KEY, null);
        if (!pendingMsg) return;

        let inputPane = document.querySelector('footer div[contenteditable="true"]') ||
                        document.querySelector('div[data-tab="10"] div[contenteditable="true"]') ||
                        document.querySelector('#main div.lexical-rich-text-input div[contenteditable="true"]');

        if (!inputPane) {
            const inputs = Array.from(document.querySelectorAll('div[contenteditable="true"]'));
            if (inputs.length > 0) inputPane = inputs[inputs.length - 1];
        }

        if (inputPane) {
            GM_setValue(STORAGE_KEY, null); // Instantly drain the channel buffer
            inputPane.focus();
            document.execCommand('selectAll', false, null);
            document.execCommand('delete', false, null);

            const lines = pendingMsg.split('\n');
            lines.forEach((line, i) => {
                document.execCommand('insertText', false, line);
                if (i < lines.length - 1) {
                    const shiftEnter = new KeyboardEvent('keydown', {
                        bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', keyCode: 13, shiftKey: true
                    });
                    inputPane.dispatchEvent(shiftEnter);
                }
            });

            inputPane.dispatchEvent(new Event('input', { bubbles: true }));

            setTimeout(() => {
                const sendBtn = document.querySelector('button span[data-icon="send"]')?.parentElement ||
                                document.querySelector('button[aria-label="Send"]');
                if (sendBtn) sendBtn.click();
            }, 400);
        }
    }, 1500);
}

// =========================================================================
// INITIALIZATION ROUTER
// =========================================================================
if (window.location.hostname.includes('whatsapp.com')) {
    handleWhatsAppInjection();
} else {
    console.log("%c[Forwarder] Unified Platform Scanner Initialized!", "color: #00ffff; font-weight: bold;");
    setInterval(scanDashboardLayout, 2000);
}
