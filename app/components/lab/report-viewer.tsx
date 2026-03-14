"use client";

import { useState, useEffect } from "react";

export default function ReportViewer() {
  const [reports, setReports] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/lab/reports")
      .then((r) => r.json())
      .then((data) => {
        const list = data.reports || [];
        setReports(list);
        if (list.length > 0) setSelected(list[0]);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selected) {
      setContent(null);
      return;
    }
    setContent(null);
    fetch(`/api/lab/reports?name=${encodeURIComponent(selected)}`)
      .then((r) => r.json())
      .then((data) => setContent(data.content || null))
      .catch(() => setContent("Failed to load report."));
  }, [selected]);

  if (loading) {
    return <div className="py-12 text-center text-zinc-500 text-sm">Loading reports...</div>;
  }

  if (reports.length === 0) {
    return (
      <div className="py-12 text-center text-zinc-500 text-sm">
        No reports yet. Run signal tests and generate a report.
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4">
        <select
          value={selected || ""}
          onChange={(e) => setSelected(e.target.value)}
          className="bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm rounded-lg px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
        >
          {reports.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>

      {content ? (
        <pre className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 text-zinc-300 text-[13px] leading-relaxed whitespace-pre-wrap overflow-x-auto font-mono">
          {content}
        </pre>
      ) : selected ? (
        <div className="py-8 text-center text-zinc-500 text-sm">Loading...</div>
      ) : null}
    </div>
  );
}
