import { applyEdits, PLAYER_EDIT_KEYS, randomDigitString } from "./cardEdits";
import type { CardEdits, CardRecord, PrintField, PrintFieldValue } from "./types";

type EditorPanelProps = {
  card: CardRecord | null;
  edits: CardEdits | undefined;
  onChange: (fieldKey: string, value: PrintFieldValue) => void;
  onPlayerChange: (fieldKey: string, value: PrintFieldValue) => void;
};

function isPlayerField(field: PrintField) {
  return PLAYER_EDIT_KEYS.has(field.key);
}

export function EditorPanel({ card, edits, onChange, onPlayerChange }: EditorPanelProps) {
  if (!card) {
    return (
      <aside className="editor-panel empty" aria-label="Card editor">
        No card selected
      </aside>
    );
  }

  const merged = applyEdits(card, edits);
  const visibleFields = merged.printFields.filter((field) => field.fieldType !== "metadata");
  const playerFields = visibleFields.filter(isPlayerField);
  const valueFields = visibleFields.filter(
    (field) => !isPlayerField(field) && field.fieldType !== "bool",
  );
  const flagFields = visibleFields.filter(
    (field) => !isPlayerField(field) && field.fieldType === "bool",
  );
  const holoFlagIndex = flagFields.findIndex((field) => field.key === "holo");
  if (holoFlagIndex > 0) flagFields.unshift(flagFields.splice(holoFlagIndex, 1)[0]);

  const playerDataApplies = merged.game !== "CHU" && playerFields.length > 0;
  const overrideCount = Object.keys(edits ?? {}).filter((key) => !PLAYER_EDIT_KEYS.has(key)).length;

  return (
    <aside className="editor-panel" aria-label="Card editor">
      <div className="editor-scroll">
        <section className="editor-section">
          <div className="editor-header">
            <h3>Player Data</h3>
            <span>{playerDataApplies ? "Shared across cards" : "Not applicable"}</span>
          </div>
          {playerDataApplies ? (
            <div className="form-grid player-data-grid">
              {playerFields.map((field) => (
                <PrintFieldControl key={field.key} field={field} onChange={onPlayerChange} />
              ))}
            </div>
          ) : null}
        </section>

        <section className="editor-section">
          <div className="editor-header">
            <h3>Print Surface</h3>
            <span>{overrideCount === 1 ? "1 override" : `${overrideCount} overrides`}</span>
          </div>
          <div className="form-grid">
            {valueFields.map((field) => (
              <PrintFieldControl key={field.key} field={field} onChange={onChange} />
            ))}
            {flagFields.length > 0 ? (
              <div className="flag-section">
                <h4>Visibility / print flags</h4>
                {flagFields.map((field) => (
                  <PrintFieldControl key={field.key} field={field} onChange={onChange} />
                ))}
              </div>
            ) : null}
          </div>
        </section>
      </div>

      <details className="edit-json">
        <summary>Override JSON</summary>
        <pre>{JSON.stringify(edits ?? {}, null, 2)}</pre>
      </details>
    </aside>
  );
}

export function PrintFieldControl({
  field,
  onChange,
}: {
  field: PrintField;
  onChange: (fieldKey: string, value: PrintFieldValue) => void;
}) {
  if (field.fieldType === "bool") {
    return (
      <label className="control toggle-control">
        <input
          type="checkbox"
          checked={field.value === "true"}
          onChange={(event) => onChange(field.key, event.target.checked)}
        />
        <span>{field.label}</span>
      </label>
    );
  }

  if (field.fieldType === "multiline") {
    return (
      <label className="control wide">
        <span>{field.label}</span>
        <textarea
          value={field.value ?? ""}
          onChange={(event) => onChange(field.key, event.target.value)}
          rows={5}
        />
      </label>
    );
  }

  if (field.fieldType === "select") {
    return (
      <label className="control">
        <span>{field.label}</span>
        <select value={field.value ?? ""} onChange={(event) => onChange(field.key, event.target.value)}>
          {(field.options ?? []).map((option) => (
            <option value={option.value} key={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    );
  }

  const inputId = `print-field-${field.key}`;
  const input = (
    <input
      id={inputId}
      type={field.fieldType === "number" ? "number" : "text"}
      value={field.value ?? ""}
      onChange={(event) => onChange(field.key, event.target.value)}
    />
  );

  if (field.key === "serialId") {
    return (
      <div className="control">
        <label className="control-label" htmlFor={inputId}>
          {field.label}
        </label>
        <span className="input-with-action">
          {input}
          <button
            type="button"
            className="input-action-button"
            aria-label="Generate 20 digit random serial"
            title="Generate 20 digit random serial"
            onClick={() => onChange(field.key, randomDigitString(20))}
          >
            ↻
          </button>
        </span>
      </div>
    );
  }

  return (
    <label className="control" htmlFor={inputId}>
      <span>{field.label}</span>
      {input}
    </label>
  );
}
