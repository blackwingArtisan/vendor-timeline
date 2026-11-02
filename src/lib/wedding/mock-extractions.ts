/** What a correct read of each sample looks like. Used when AI is in mock mode. */
import { BAND, CATERER, FLORIST, PHOTOGRAPHER, VENUE, WEDDING_DAY } from "./samples";
import type { Extraction } from "./extraction-schema";

const nothing = { written: null, sentence: null, problem: null };

const FIXTURES: { marker: string; extraction: Extraction }[] = [
  {
    marker: PHOTOGRAPHER.vendorName,
    extraction: {
      vendor_name: { value: PHOTOGRAPHER.vendorName, sentence: `This Agreement is made on October 12, 2026 between Quillfeather Photo Studio ("Photographer") and Maya Okafor and Jonas Lindqvist ("Clients").`, problem: null },
      vendor_role: "photographer",
      payee_email: { value: PHOTOGRAPHER.payeeEmail, sentence: "Please send all payments by PayPal to billing@quillfeather-photo.example.com.", problem: null },
      event_date: { value: WEDDING_DAY, sentence: `Photographer will photograph the Clients' wedding on June 12, 2027 (the "Event Date") at Thistlewick Barn & Gardens in Alder Falls.`, problem: null },
      signing_date: { value: "2026-10-12", sentence: `This Agreement is made on October 12, 2026 between Quillfeather Photo Studio ("Photographer") and Maya Okafor and Jonas Lindqvist ("Clients").`, problem: null },
      total: { written: "$4,800.00", sentence: `The total fee for the services in this Agreement is $4,800.00 (the "Total Fee").`, problem: null },
      deposit: { written: "25%", sentence: "A non-refundable retainer of 25% of the Total Fee is due on or before December 18, 2026 to reserve the Event Date.", problem: null },
      deposit_due: { timing: "fixed_date", date: PHOTOGRAPHER.depositDue, days: null, sentence: "A non-refundable retainer of 25% of the Total Fee is due on or before December 18, 2026 to reserve the Event Date.", problem: null },
      balance: { written: "$3,600.00", sentence: "The remaining balance of $3,600.00 is due thirty (30) days before the Event Date.", problem: null },
      balance_due: { timing: "days_before_event", date: null, days: 30, sentence: "The remaining balance of $3,600.00 is due thirty (30) days before the Event Date.", problem: null },
    },
  },
  {
    marker: CATERER.vendorName,
    extraction: {
      vendor_name: { value: CATERER.vendorName, sentence: "Accepted by Client and by Saltmeadow Table Catering.", problem: null },
      vendor_role: "caterer",
      payee_email: { value: CATERER.payeeEmail, sentence: "Remit all payments via PayPal to accounts@saltmeadow-table.example.com.", problem: null },
      event_date: { value: WEDDING_DAY, sentence: "Event: Wedding reception, Saturday, June 12, 2027, Thistlewick Barn & Gardens", problem: null },
      signing_date: { value: "2026-10-19", sentence: "Date of this contract: October 19, 2026", problem: null },
      total: { written: "$12,960.00", sentence: "Contract Total: $12,960.00", problem: null },
      deposit: { written: "$2,500.00", sentence: "Client shall remit a deposit of Two Thousand Five Hundred Dollars ($2,500.00) no later than January 15, 2027.", problem: null },
      deposit_due: { timing: "fixed_date", date: CATERER.depositDue, days: null, sentence: "Client shall remit a deposit of Two Thousand Five Hundred Dollars ($2,500.00) no later than January 15, 2027.", problem: null },
      balance: { written: "$10,640.00", sentence: "The final payment of $10,640.00 shall be received by Caterer fourteen (14) calendar days prior to the Event.", problem: null },
      balance_due: { timing: "days_before_event", date: null, days: 14, sentence: "The final payment of $10,640.00 shall be received by Caterer fourteen (14) calendar days prior to the Event.", problem: null },
    },
  },
  {
    marker: "Site License Agreement", // Other contracts name the venue too
    extraction: {
      vendor_name: { value: VENUE.vendorName, sentence: "A. License. Thistlewick Barn & Gardens grants Licensee exclusive use of the barn, the walled garden and the parking meadow from 10:00 a.m. to 11:00 p.m. on the Event Date.", problem: null },
      vendor_role: "venue",
      payee_email: { value: VENUE.payeeEmail, sentence: "Payments are accepted by PayPal at events@thistlewick-barn.example.com.", problem: null },
      event_date: { value: WEDDING_DAY, sentence: "Event Date: Saturday, June 12, 2027", problem: null },
      signing_date: { value: "2026-09-28", sentence: "Agreement date: September 28, 2026", problem: null },
      total: { written: "$9,000.00", sentence: `The fee for this license is Nine Thousand Dollars ($9,000.00) (the "License Fee").`, problem: null },
      deposit: { written: "$3,000.00", sentence: "Licensee will make a booking payment of $3,000.00, which is applied to the License Fee, on or before February 1, 2027.", problem: null },
      deposit_due: { timing: "fixed_date", date: VENUE.depositDue, days: null, sentence: "Licensee will make a booking payment of $3,000.00, which is applied to the License Fee, on or before February 1, 2027.", problem: null },
      balance: { ...nothing, sentence: "The rest of the License Fee is payable no later than 60 days before the Event Date." },
      balance_due: { timing: "days_before_event", date: null, days: 60, sentence: "The rest of the License Fee is payable no later than 60 days before the Event Date.", problem: null },
    },
  },
  {
    marker: FLORIST.vendorName,
    extraction: {
      vendor_name: { value: FLORIST.vendorName, sentence: "Bramble & Vetch Floral", problem: null },
      vendor_role: "florist",
      payee_email: { value: FLORIST.payeeEmail, sentence: "You can pay us on PayPal at hello@bramble-vetch.example.com.", problem: null },
      event_date: { value: WEDDING_DAY, sentence: "Here is everything we talked about for your wedding on June 12, 2027.", problem: null },
      signing_date: { value: null, sentence: null, problem: null },
      total: { written: "$2,340", sentence: "Your flowers come to $2,340 all in.", problem: null },
      deposit: { written: "$600", sentence: "To hold your date we ask for $600 by October 23, 2026.", problem: null },
      deposit_due: { timing: "fixed_date", date: FLORIST.depositDue, days: null, sentence: "To hold your date we ask for $600 by October 23, 2026.", problem: null },
      balance: { written: "$1,740", sentence: "The rest ($1,740) is due two weeks before your wedding.", problem: null },
      balance_due: { timing: "days_before_event", date: null, days: 14, sentence: "The rest ($1,740) is due two weeks before your wedding.", problem: null },
    },
  },
  {
    marker: BAND.vendorName,
    extraction: {
      vendor_name: { value: BAND.vendorName, sentence: "Artist: The Velvet Almanacs, a six-piece band", problem: null },
      vendor_role: "band",
      payee_email: { value: null, sentence: "The bandleader will confirm how to pay closer to the date.", problem: "The contract gives no address to pay." },
      event_date: { value: WEDDING_DAY, sentence: "Engagement: Wedding reception, June 12, 2027, 7:00 p.m. to 11:00 p.m., Thistlewick Barn & Gardens", problem: null },
      signing_date: { value: null, sentence: null, problem: null },
      total: { written: "$3,200.00", sentence: "Purchaser agrees to pay Artist a flat guarantee of $3,200.00 for the engagement.", problem: null },
      deposit: { written: "$800.00", sentence: "A deposit of $800.00 is due by March 1, 2027, or this date may be released.", problem: null },
      deposit_due: { timing: "fixed_date", date: BAND.depositDue, days: null, sentence: "A deposit of $800.00 is due by March 1, 2027, or this date may be released.", problem: null },
      balance: { ...nothing, sentence: "The balance of the guarantee is due before the band loads in." },
      balance_due: { timing: "unclear", date: null, days: null, sentence: "The balance of the guarantee is due before the band loads in.", problem: "\"Before the band loads in\" doesn't give a day." },
    },
  },
];

const blankDate = { timing: "not_stated", date: null, days: null, sentence: null, problem: null } as const;
const blankText = { value: null, sentence: null, problem: null };

/** A contract with no fixture: nothing is read, so the couple sees every term flagged. */
export const UNREAD: Extraction = {
  vendor_name: blankText,
  vendor_role: "other",
  payee_email: blankText,
  event_date: blankText,
  signing_date: blankText,
  total: nothing,
  deposit: nothing,
  deposit_due: blankDate,
  balance: nothing,
  balance_due: blankDate,
};

export function mockExtraction(text: string): Extraction {
  // A PDF breaks its lines in new places, so a name can land across two.
  const flat = text.replace(/\s+/g, " ");
  return FIXTURES.find((f) => flat.includes(f.marker))?.extraction ?? UNREAD;
}
