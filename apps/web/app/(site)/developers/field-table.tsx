import type { DocField } from "../../../lib/api-docs";

export function FieldTable({ caption, rows }: { caption: string; rows: readonly DocField[] }) {
  return (
    <div className="dev-table-wrap">
      <table className="dev-table" aria-label={caption}>
        <thead>
          <tr>
            <th scope="col">Field</th>
            <th scope="col">Meaning</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.name}>
              <th scope="row">
                <code>{row.name}</code>
              </th>
              <td>{row.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
