import React, { useState } from 'react';
import DiagramView from './DiagramView.jsx';
import { DIAGRAM_IDS, loadDiagram } from './diagrams/index.js';

export function DiagramTab() {
  const [id, setId] = useState(DIAGRAM_IDS[0]);
  const diagram = loadDiagram(id);
  return (
    <div>
      <div className="dg-picker" role="group" aria-label="Choose a diagram">
        {DIAGRAM_IDS.map((did) => (
          <button
            key={did}
            className={did === id ? 'active' : ''}
            aria-pressed={did === id}
            onClick={() => setId(did)}
          >
            {loadDiagram(did).title}
          </button>
        ))}
      </div>
      <DiagramView key={id} id={id} />
    </div>
  );
}
