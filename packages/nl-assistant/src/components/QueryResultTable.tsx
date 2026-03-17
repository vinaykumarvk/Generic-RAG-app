interface Props {
  data: Record<string, unknown>[];
}

export function QueryResultTable({ data }: Props) {
  if (!data.length) return null;

  const columns = Object.keys(data[0]);

  return (
    <div className="assistant-table-wrap">
      <table className="assistant-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col}>{col}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.slice(0, 50).map((row, rowIdx) => (
            <tr key={rowIdx}>
              {columns.map((col) => (
                <td key={col} data-label={col}>
                  {formatCell(row[col])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
