import { expect, test, type Page } from "@playwright/test";
import { amountText, formatCents } from "../../src/lib/wedding/cents";
import { PHOTOGRAPHER } from "../../src/lib/wedding/samples";

const live = process.env.E2E_AI_MODE === "live";

/** A valid PDF with one blank page, like a scan: nothing in it to read. */
const BLANK_PDF = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");

async function upload(page: Page, file: Parameters<Page["setInputFiles"]>[1]) {
  await page.goto("/contracts");
  await expect(page.getByTestId("contracts-loaded")).toBeAttached();
  await page.getByTestId("upload-contract").setInputFiles(file);
}

test("a PDF contract goes in, gets read into terms and reaches the timeline", async ({ page }) => {
  // On a plan of the couple's own, so this contract is the only one.
  await page.goto("/timeline");
  await page.getByTestId("start-own-plan").click();
  await expect(page.getByText("Nothing confirmed yet")).toBeVisible();
  await upload(page, "public/sample-contracts/photographer.pdf");
  await expect(page.getByTestId("contract-text")).toHaveValue(/Quillfeather/, { timeout: 30_000 });
  // The screen says the text came from the uploaded PDF, by name; typing in the box takes that away.
  await expect(page.getByTestId("pdf-loaded")).toHaveText("photographer.pdf uploaded. The text below was taken from the PDF.");
  await page.getByTestId("read-contract").click();
  await page.waitForURL(/\/contracts\/ctr_/, { timeout: 90_000 });

  await expect(page.getByLabel("Vendor name")).toHaveValue(PHOTOGRAPHER.vendorName);
  await expect(page.getByLabel("Total", { exact: true })).toHaveValue(amountText(PHOTOGRAPHER.totalCents));
  await expect(page.getByLabel("Deposit", { exact: true })).toHaveValue(amountText(PHOTOGRAPHER.depositCents));
  await expect(page.getByLabel("Deposit due")).toHaveValue(PHOTOGRAPHER.depositDue);
  await expect(page.getByTestId("balance-value")).toHaveText(formatCents(PHOTOGRAPHER.balanceCents));
  // The app checks each quote against the contract, so a broken line would show up here.
  for (const name of ["total", "deposit", "deposit-due"]) await expect(page.getByTestId(`source-${name}`)).not.toContainText("No sentence in the contract");
  await page.screenshot({ path: `screenshots/review-pdf-${live ? "live-ai" : "mock-ai"}.png`, fullPage: true });
  if (live) {
    const id = new URL(page.url()).pathname.split("/").pop();
    const contract = await (await page.request.get(`/api/contracts/${id}`)).json();
    console.log(`Real AI read of the PDF: ${JSON.stringify(contract.read)}`);
    return;
  }

  await expect(page.getByTestId("confirm-terms")).toBeEnabled();
  await page.getByTestId("confirm-terms").click();
  await page.waitForURL(/\/timeline/);
  await expect(page.getByTestId("timeline-item")).toHaveCount(2);
});

test("the sample PDF button fills the box", async ({ page }) => {
  test.skip(live, "One real read is enough");
  await page.goto("/contracts");
  await expect(page.getByTestId("contracts-loaded")).toBeAttached();
  await page.getByTestId("sample-pdf").click();
  await expect(page.getByTestId("contract-text")).toHaveValue(/Quillfeather/, { timeout: 30_000 });
  await expect(page.getByTestId("read-contract")).toBeEnabled();
  await expect(page.getByTestId("pdf-loaded")).toHaveAttribute("data-file", "photographer.pdf");
  // Edited by hand, it's no longer just the PDF's text.
  await page.getByTestId("contract-text").press("End");
  await page.getByTestId("contract-text").pressSequentially(" Added by hand.");
  await expect(page.getByTestId("pdf-loaded")).toHaveCount(0);
});

test("a PDF with no text says why and still has a way forward", async ({ page }) => {
  test.skip(live, "No AI here");
  await upload(page, { name: "scan.pdf", mimeType: "application/pdf", buffer: BLANK_PDF });
  await expect(page.getByTestId("read-blocked")).toContainText("no text to read", { timeout: 30_000 });
  await page.screenshot({ path: "screenshots/pdf-no-text.png" });
  await page.getByTestId("enter-terms").click();
  await page.waitForURL(/\/contracts\/ctr_/);
  await expect(page.getByTestId("read-by")).toHaveText("Not read by AI");
});

test("a file that only claims to be a PDF is turned away", async ({ page }) => {
  test.skip(live, "No AI here");
  await upload(page, { name: "contract.pdf", mimeType: "application/pdf", buffer: Buffer.from("this is not a pdf at all") });
  await expect(page.getByTestId("read-blocked")).toContainText("isn't a PDF", { timeout: 30_000 });
});
