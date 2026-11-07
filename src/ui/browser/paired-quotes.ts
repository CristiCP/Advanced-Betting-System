import type {
  UiPairedQuoteRow,
  UiProvider,
  UiQuoteView,
} from "../model/ui.interfaces.js";

/** @file Joins unique canonical lines from both selected sources for a single table row. */

export function pairedQuoteRows(
  views: Partial<Record<UiProvider, UiQuoteView>>,
): UiPairedQuoteRow[] {
  const left = views.superbet;
  const right = views.betano;
  if (
    !left?.synchronized ||
    !right?.synchronized ||
    left.truncated ||
    right.truncated
  )
    return [];
  const other = new Map(
    right.rows
      .filter((row) => row.canonicalKey !== null)
      .map((row) => [row.canonicalKey!, row]),
  );
  return left.rows.flatMap((row) => {
    const counterpart =
      row.canonicalKey === null ? undefined : other.get(row.canonicalKey);
    return counterpart
      ? [
          {
            key: String(row.canonicalKey),
            market: row.concept ?? row.market,
            line: row.line,
            superbet: row,
            betano: counterpart,
          },
        ]
      : [];
  });
}
