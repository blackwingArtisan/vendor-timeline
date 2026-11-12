/** What `sponsor-chart` loads with the sponsor switch off. Never shown: see payment-chart.tsx. */
function SponsorOff() {
  return null;
}

export default async function loadSponsorChart() {
  return SponsorOff;
}
