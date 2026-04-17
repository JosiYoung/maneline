import { PdfDoc } from './pdf-minimal.js';

/**
 * Render a 12-month records PDF for one animal.
 *
 * Inputs:
 *   animal        — { barn_name, species, breed, year_born, discipline, owner_id }
 *   ownerName     — owner's display name (user_profiles.display_name)
 *   windowDays    — how far back we pulled records (for the cover block)
 *   vetRecords    — array of { record_type, issued_on, expires_on, issuing_provider, notes }
 *   mediaCount    — int; we print "N photos on file" but don't embed them yet
 *
 * Returns a Uint8Array that callers push straight to R2.
 *
 * Phase 1 skips the 4×2 photo grid — JPEG/PNG embedding would double
 * the size of pdf-minimal.js. The cover page notes the photo count
 * so the vet/buyer knows there's more in the portal.
 */
export function renderRecordsPdf({
  animal,
  ownerName,
  windowDays,
  vetRecords,
  mediaCount = 0,
}) {
  const doc = new PdfDoc();
  const now = new Date();
  const rangeStart = new Date(now);
  rangeStart.setDate(rangeStart.getDate() - windowDays);

  /* --- Cover block --- */
  doc.text('MANE LINE', { size: 10, bold: true, color: [0.24, 0.48, 0.24] });
  doc.space(2);
  doc.text('Records export', { size: 22, bold: true });
  doc.space(6);
  doc.text(animal.barn_name || 'Unnamed animal', { size: 28, bold: true });
  doc.space(2);
  doc.text(
    [cap(animal.species), animal.breed, animal.year_born ? `Born ${animal.year_born}` : null, animal.discipline]
      .filter(Boolean)
      .join('  ·  '),
    { size: 12, color: [0.4, 0.4, 0.4] }
  );
  doc.space(12);
  doc.rule();
  doc.space(4);
  doc.textWrapped(`Owner: ${ownerName || '—'}`, { size: 11 });
  doc.textWrapped(
    `Coverage: last ${windowDays} days (${fmtDate(rangeStart)} → ${fmtDate(now)})`,
    { size: 11 }
  );
  doc.textWrapped(`Generated: ${fmtDateTime(now)}`, { size: 11 });
  doc.space(18);

  /* --- Vet records, grouped by type --- */
  doc.text('Vet records', { size: 16, bold: true });
  doc.space(4);

  if (vetRecords.length === 0) {
    doc.textWrapped(
      'No vet records were on file for this animal within the selected window.',
      { size: 11, bold: false }
    );
  } else {
    const groups = groupByType(vetRecords);
    for (const [type, rows] of groups) {
      doc.space(6);
      doc.text(cap(type), { size: 13, bold: true });
      doc.rule({ color: [0.24, 0.48, 0.24] });
      for (const r of rows) {
        doc.space(2);
        const header = [
          r.issued_on ? `Issued ${fmtDate(r.issued_on)}` : null,
          r.expires_on ? `Expires ${fmtDate(r.expires_on)}` : null,
          r.issuing_provider || null,
        ]
          .filter(Boolean)
          .join('  ·  ') || 'No dates recorded';
        doc.textWrapped(header, { size: 11, bold: true });
        if (r.notes) {
          doc.textWrapped(r.notes, { size: 10, indent: 8 });
        }
        doc.textWrapped(`File: ${r.filename || '—'}`, { size: 9, indent: 8 });
        doc.space(2);
      }
    }
  }

  /* --- Protocol log placeholder --- */
  doc.space(18);
  doc.text('Protocol log', { size: 16, bold: true });
  doc.space(2);
  doc.textWrapped(
    'Protocol log begins in Phase 2 of Mane Line. Confirmed doses, ' +
      'supplement schedules, and Protocol Brain suggestions will appear ' +
      'here once that view is live.',
    { size: 11 }
  );

  /* --- Media footnote --- */
  doc.space(18);
  doc.text('Photos', { size: 16, bold: true });
  doc.space(2);
  doc.textWrapped(
    mediaCount === 0
      ? 'No photos on file for this animal yet.'
      : `${mediaCount} photo${mediaCount === 1 ? '' : 's'} on file in the Mane Line portal. Ask the owner for a share link to view.`,
    { size: 11 }
  );

  return doc.build();
}

function groupByType(records) {
  const order = ['coggins', 'vaccine', 'dental', 'farrier', 'other'];
  const groups = new Map();
  for (const t of order) groups.set(t, []);
  for (const r of records) {
    const bucket = groups.get(r.record_type) || [];
    bucket.push(r);
    groups.set(r.record_type, bucket);
  }
  // Most recent first within each group.
  for (const [k, v] of groups) {
    v.sort((a, b) => dateKey(b) - dateKey(a));
    if (v.length === 0) groups.delete(k);
  }
  return groups;
}

function dateKey(r) {
  const d = r.issued_on ? new Date(r.issued_on) : new Date(r.created_at || 0);
  return d.getTime();
}

function cap(s) {
  if (!s || typeof s !== 'string') return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function fmtDate(d) {
  const dt = typeof d === 'string' ? new Date(d) : d;
  if (!dt || Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function fmtDateTime(d) {
  const dt = typeof d === 'string' ? new Date(d) : d;
  return `${fmtDate(dt)} ${dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
}
