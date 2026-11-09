/**
 * A small RFC 5545 reader for tests: unfolds lines, then reads each VEVENT's properties, with text
 * values unescaped. Enough to check what a calendar app would show.
 */
export interface IcsEvent {
  [name: string]: string;
}

export function parseIcs(text: string): { calendar: IcsEvent; events: IcsEvent[]; lines: string[] } {
  if (!text.endsWith("\r\n")) throw new Error("An iCalendar file ends with CRLF");
  const raw = text.slice(0, -2).split("\r\n");
  for (const line of raw) if (Buffer.byteLength(line) > 75) throw new Error(`Line longer than 75 octets: ${line}`);
  const lines: string[] = [];
  for (const line of raw) {
    if (line.startsWith(" ") || line.startsWith("\t")) lines[lines.length - 1] += line.slice(1);
    else lines.push(line);
  }
  if (lines[0] !== "BEGIN:VCALENDAR" || lines.at(-1) !== "END:VCALENDAR") throw new Error("Not one VCALENDAR");
  const calendar: IcsEvent = {};
  const events: IcsEvent[] = [];
  let current: IcsEvent | null = null;
  for (const line of lines.slice(1, -1)) {
    if (line === "BEGIN:VEVENT") {
      if (current) throw new Error("Nested VEVENT");
      current = {};
      continue;
    }
    if (line === "END:VEVENT") {
      if (!current) throw new Error("END:VEVENT without BEGIN");
      events.push(current);
      current = null;
      continue;
    }
    const colon = line.indexOf(":");
    if (colon < 1) throw new Error(`Bad line: ${line}`);
    const name = line.slice(0, colon);
    const value = line.slice(colon + 1).replace(/\\([\;,nN])/g, (_m, c: string) => (c === "n" || c === "N" ? "\n" : c));
    (current ?? calendar)[name] = value;
  }
  if (current) throw new Error("VEVENT left open");
  return { calendar, events, lines };
}
