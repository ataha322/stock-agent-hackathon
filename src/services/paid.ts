import { PaidClient } from "@paid-ai/paid-node";
import { logger } from "../utils/logger";

const CUSTOMER_EXT_ID = "joe";
const AGENT_EXT_ID = "sentry_agent";

export const NEWS_SIGNAL = "news_summary";
export const FINANCIAL_EVENT_SIGNAL = "major_events";

const paidClient = new PaidClient({ token: process.env.PAID_API_KEY ?? "" });
// await paidClient.initializeTracing();

export async function sendPaidSignal(name: string, data: Record<string, any>) {
    // paidClient.trace(
    //     CUSTOMER_EXT_ID,
    //     () => {
    //         paidClient.signal(name, data);
    //         logger.info("Paid trace is sent");
    //     },
    //     AGENT_EXT_ID,
    // );

    await paidClient.usage.record({
        event_name: name,
        customer_id: CUSTOMER_EXT_ID,
        external_agent_id: AGENT_EXT_ID,
        data,
    });
    paidClient.usage.flush();
}
