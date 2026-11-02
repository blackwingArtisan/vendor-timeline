/** What the model is asked to return. It copies from the contract; the app does all the working out. */
import { z } from "zod";
import { VENDOR_ROLES } from "./types";

const sentence = z.string().nullable().describe("The full contract sentence or line it came from, copied character for character. Null if there isn't one.");
const problem = z.string().nullable().describe("If this term is missing or unclear, why, in one short plain sentence. Otherwise null.");

const TextTerm = z.object({ value: z.string().nullable(), sentence, problem });

const DayTerm = z.object({ value: z.string().nullable().describe("The date as YYYY-MM-DD, however the contract writes it. Null if it doesn't state one."), sentence, problem });

const AmountTerm = z.object({
  written: z.string().nullable().describe('The amount exactly as the contract writes it, such as "$4,800.00" or "25%". Null if the contract states no figure for it. Never work one out.'),
  sentence,
  problem,
});

const DateTerm = z.object({
  timing: z.enum(["fixed_date", "days_before_event", "days_after_signing", "on_signing", "not_stated", "unclear"]),
  date: z.string().nullable().describe("YYYY-MM-DD, only when timing is fixed_date."),
  days: z.number().nullable().describe('Whole calendar days, only when timing is days_before_event or days_after_signing. "Two weeks" is 14.'),
  sentence,
  problem,
});

export const Extraction = z.object({
  vendor_name: TextTerm,
  vendor_role: z.enum(VENDOR_ROLES),
  payee_email: TextTerm.describe("The email address the contract says to pay."),
  event_date: DayTerm.describe("The wedding day."),
  signing_date: DayTerm.describe("The date of the contract, if it states one."),
  total: AmountTerm.describe("The vendor's whole price."),
  deposit: AmountTerm.describe("The first payment that holds the date, which may be called a deposit, retainer or booking payment."),
  deposit_due: DateTerm,
  balance: AmountTerm.describe("The payment that clears what is left after the deposit."),
  balance_due: DateTerm,
});
export type Extraction = z.infer<typeof Extraction>;
