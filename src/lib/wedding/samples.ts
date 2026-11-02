/**
 * The fictional sample contracts in public/sample-contracts, with what each really says. These
 * are the app's only demo numbers: the AI fixtures, the landing page and the tests all read them.
 */
import type { VendorRole } from "./types";

export const WEDDING_DAY = "2027-06-12";

export interface SampleFacts {
  file: string;
  label: string;
  vendorName: string;
  vendorRole: VendorRole;
  payeeEmail: string | null;
  totalCents: number;
  depositCents: number;
  /** Total minus deposit, whatever the contract claims. */
  balanceCents: number;
  depositDue: string;
  /** Null when the contract gives no date a person could act on. */
  balanceDue: string | null;
}

export const PHOTOGRAPHER: SampleFacts = {
  file: "photographer.txt",
  label: "Photographer",
  vendorName: "Quillfeather Photo Studio",
  vendorRole: "photographer",
  payeeEmail: "billing@quillfeather-photo.example.com",
  totalCents: 480_000,
  depositCents: 120_000,
  balanceCents: 360_000,
  depositDue: "2026-12-18",
  balanceDue: "2027-05-13",
};

export const CATERER: SampleFacts = {
  file: "caterer.txt",
  label: "Caterer",
  vendorName: "Saltmeadow Table Catering",
  vendorRole: "caterer",
  payeeEmail: "accounts@saltmeadow-table.example.com",
  totalCents: 1_296_000,
  depositCents: 250_000,
  balanceCents: 1_046_000,
  depositDue: "2027-01-15",
  balanceDue: "2027-05-29",
};

/** The caterer's contract says the final payment is this, which doesn't match its own total. */
export const CATERER_STATED_BALANCE_CENTS = 1_064_000;

export const VENUE: SampleFacts = {
  file: "venue.txt",
  label: "Venue",
  vendorName: "Thistlewick Barn & Gardens",
  vendorRole: "venue",
  payeeEmail: "events@thistlewick-barn.example.com",
  totalCents: 900_000,
  depositCents: 300_000,
  balanceCents: 600_000,
  depositDue: "2027-02-01",
  balanceDue: "2027-04-13",
};

export const FLORIST: SampleFacts = {
  file: "florist.txt",
  label: "Florist",
  vendorName: "Bramble & Vetch Floral",
  vendorRole: "florist",
  payeeEmail: "hello@bramble-vetch.example.com",
  totalCents: 234_000,
  depositCents: 60_000,
  balanceCents: 174_000,
  depositDue: "2026-10-23",
  balanceDue: "2027-05-29",
};

export const BAND: SampleFacts = {
  file: "band.txt",
  label: "Band",
  vendorName: "The Velvet Almanacs",
  vendorRole: "band",
  payeeEmail: null,
  totalCents: 320_000,
  depositCents: 80_000,
  balanceCents: 240_000,
  depositDue: "2027-03-01",
  balanceDue: null,
};

/** What the sample couple type in for the two terms the band's contract leaves blank. */
export const BAND_ANSWERS = { payeeEmail: "bookings@velvet-almanacs.example.com", balanceDue: "2027-06-05" };

export const SAMPLES = [PHOTOGRAPHER, CATERER, VENUE, FLORIST, BAND];

export const sampleUrl = (sample: SampleFacts) => `/sample-contracts/${sample.file}`;
