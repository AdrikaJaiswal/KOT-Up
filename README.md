# KOT UP (BETA)

An automation user script built for browser extensions like Tampermonkey. It automatically extracts accepted, live order details directly from active restaurant dashboard queues to generate clean Kitchen Order Tickets (KOTs), seamlessly injecting formatted text straight into a designated kitchen WhatsApp chat.

---

## How to Use:

### 1. Prerequisites
Ensure you have a user script manager extension installed on your desktop browser:
*   [Tampermonkey for Chrome/Edge/Firefox](https://www.tampermonkey.net/)

### 2. Installation
1. Open your browser and click on the **Tampermonkey** extension icon.
2. Go to the **Dashboard** and select the **Plus (+)** icon to create a new script.
3. Completely delete any default template code.
4. Copy the entire contents of `script.js` from this repository, paste it into the editor, and save (**File -> Save** or `Ctrl + S`).

### 3. Running the System
1. **Open WhatsApp Web**: Keep a browser tab permanently open on [WhatsApp Web](https://web.whatsapp.com) and click into the specific chat group meant for your kitchen crew.
2. **Open Your Dashboard Tab**: Keep your food merchant dashboard tab open on the live **Preparing** screen view column where accepted orders display.
3. The script will initialize automatically in the console. The moment a new incoming order displays, the details will be scraped, formatted, and instantly shot over to your kitchen chat window!

---

## Configuration Note ⚙️
The script operates automatically on active windows based on standard layout selectors. To prevent background loop memory clashes, refresh your active browser session if structural changes occur on the live delivery dashboard page.
