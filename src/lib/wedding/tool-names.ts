/** The payment tool's name, shared by the server and the agent panel. Safe to import in the browser. */
export const VENDOR_ORDER_TOOL = "create_vendor_order";

/** The agent's read of every confirmed payment. Its output is drawn as cards in the agent panel. */
export const REVIEW_TOOL = "review_payments";

/** The reply agent's tools: read the vendor's answer, then move the date once the couple approve. */
export const READ_REPLY_TOOL = "read_vendor_reply";
export const MOVE_TOOL = "move_due_date";
