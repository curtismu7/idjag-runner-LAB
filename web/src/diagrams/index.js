import tokenExchangeDiagram from './idjag-grant.json';

// Static diagram is diagram-studio/1 data, vendored from the shared diagram-studio library by id
// (pfidjag-jag) and loaded by its own id here. No nodes or edges are built in JSX (rule 17).
const ALL = [tokenExchangeDiagram];
const BY_ID = new Map(ALL.map((diagram) => [diagram.id, diagram]));

export function loadDiagram(id) {
  const diagram = BY_ID.get(id);
  if (!diagram) throw new Error(`Unknown diagram: ${id}`);
  return diagram;
}
export const DIAGRAM_IDS = ALL.map((diagram) => diagram.id);
export const CARD_DIAGRAM = { flow: 'pfidjag-jag' };
