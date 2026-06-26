// ==UserScript==
// @name         Swiggy Zomato Order Forwarder (Restaurant-Aware Dual-Format Master Fix)
// @namespace    http://tampermonkey.net/
// @version      2.8.1
// @description  Simultaneously extract inline brackets/parentheses [X Pcs]/(X Pcs) and subscript text on both platforms.
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
// UNIFIED MERGING & CASING ENGINE
// =========================================================================
function compileAndMergeItems(rawItemsList) {
    const mergedMap = new Map();

    rawItemsList.forEach(item => {
        let cleanName = item.name.trim();
        let quantity = item.quantity;

        // Strip brackets, parentheses, price metrics, and messy white spacing
        cleanName = cleanName
            .replace(/\[[^\]]*\]/g, '')
            .replace(/\([^\)]*\)/g, '')
            .replace(/₹\s*\d+/g, '')
            .replace(/\s+/g, ' ')
            .trim();

        // Convert to crisp Title Case
        cleanName = cleanName.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');

        // Apply explicit keyword clubbing rule
        if (/kachori|kochuri/i.test(cleanName)) {
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
// UNIVERSAL DUAL-FORMAT CONTENT PARSERS
// =========================================================================
function parseZomatoCard(card) {
    const idSpan = card.querySelector('div.css-16jdd3h span font-weight, [class*="sc-jzJRlG"]');
    if (!idSpan) return null;

    const orderId = idSpan.textContent.replace(/[^0-9]/g, '').trim();
    if (!orderId || orderId.length < 4 || PROCESSED_ORDERS.has(orderId)) return null;

    const rawItems = [];
    const itemRows = card.querySelectorAll('.css-1gq83dh, .css-pnn23e, .css-68hfpx, div[height="100%"]');

    itemRows.forEach(row => {
        const nameEl = row.querySelector('.css-1mcri0u');
        const qtyEl = row.querySelector('.css-11wxfyl');

        if (nameEl && qtyEl) {
            let mainQty = parseInt(qtyEl.textContent.replace(/[^0-9]/g, '').trim(), 10) || 1;
            let rawName = nameEl.textContent.trim();

            let multiplierFound = 1;

            // CHECK TYPE 1: Inline bracket/parentheses check rule
            const inlineMatch = rawName.match(/[\[\(](\d+)\s*(?:pieces?|pcs?)[\]\)]/i);
            // CHECK TYPE 2: Subscript context check rule
            const fullRowText = row.closest('div')?.textContent || row.textContent || "";
            const subscriptMatch = fullRowText.match(/Quantity:\s*(\d+)/i);

            if (inlineMatch) {
                multiplierFound = parseInt(inlineMatch[1], 10);
            } else if (subscriptMatch) {
                multiplierFound = parseInt(subscriptMatch[1], 10);
            }

            let finalCalculatedQty = mainQty * multiplierFound;

            if (!rawItems.some(i => i.name === rawName && i.quantity === finalCalculatedQty)) {
                rawItems.push({ name: rawName, quantity: finalCalculatedQty });
            }
        }
    });

    const finalMergedItems = compileAndMergeItems(rawItems);
    return finalMergedItems.length > 0 ? { orderId, platform: 'zomato', items: finalMergedItems } : null;
}

function parseSwiggyCard(card) {
    const idEl = card.querySelector('[data-testid="last_4_digits_order_number"]');
    if (!idEl) return null;

    const orderId = idEl.textContent.replace(/[^0-9]/g, '').trim();
    if (!orderId || PROCESSED_ORDERS.has(orderId)) return null;

    const rawItems = [];
    const nameElements = card.querySelectorAll('[data-testid="item_name"]');

    nameElements.forEach(nameEl => {
        const rowContext = nameEl.closest('.css-g5y9jx');
        if (rowContext) {
            const textContent = rowContext.textContent.replace(/\s+/g, ' ');
            const qtyMatch = textContent.match(/x\s*(\d+)/i);
            let quantity = qtyMatch ? parseInt(qtyMatch[1], 10) : 1;
            let rawName = nameEl.textContent.trim();

            // CRITICAL FIX: Look for [8 Pieces], (8 Pcs), [4 pcs], etc.
            const inlineMatch = rawName.match(/[\[\(](\d+)\s*(?:pieces?|pcs?)[\]\)]/i);
            if (inlineMatch) {
                quantity = quantity * parseInt(inlineMatch[1], 10);
            }

            rawItems.push({ name: rawName, quantity: quantity });
        }
    });

    const finalMergedItems = compileAndMergeItems(rawItems);
    return finalMergedItems.length > 0 ? { orderId, platform: 'swiggy', items: finalMergedItems } : null;
}

// =========================================================================
// RUNTIME SCANNER ENGINE
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

    console.log(`%c[Forwarder] Sending Accurate Ticket:\n${msg.trim()}`, "color: #00ff00; font-weight: bold;");
    GM_setValue(STORAGE_KEY, msg.trim());
}

// =========================================================================
// WHATSAPP DISPATCH MODULE
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
            GM_setValue(STORAGE_KEY, null);
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

if (window.location.hostname.includes('whatsapp.com')) {
    handleWhatsAppInjection();
} else {
    console.log("%c[Forwarder] Dual-Format Evaluation Fix Locked!", "color: #00ffff; font-weight: bold;");
    setInterval(scanDashboardLayout, 2000);
}
