/**
 * Asks questions through POST /api/ask with stream: true, the way the chat page does, billed to the
 * tests Neuron bucket (x-vtp-suite: 1). For each: seconds to the first streamed words, seconds to the
 * finished answer, the engine and the answer text. Used by the diagnostics workflow (task ask-timing).
 *
 *   node scripts/ask-timing/run.mjs --base https://vineyardportal.org --out timing.json "question one" "question two"
 */
const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args.splice(i, 2)[1] : d;
};
const base = opt('base', 'https://vineyardportal.org');
const out = opt('out', '');
const questions = args.length ? args : ['What is the RDA and why does it matter?'];

async function ask(question) {
  const t0 = Date.now();
  const res = await fetch(`${base}/api/ask`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream', 'x-vtp-suite': '1' },
    body: JSON.stringify({ question, stream: true }),
  });
  let first = null;
  let final = null;
  if ((res.headers.get('content-type') ?? '').includes('text/event-stream')) {
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const event = /^event: (.*)$/m.exec(block)?.[1];
        const data = /^data: (.*)$/m.exec(block)?.[1];
        if (event === 'delta' && first == null) first = Date.now() - t0;
        if (event === 'done' && data) final = JSON.parse(data);
      }
    }
  } else final = await res.json();
  const total = Date.now() - t0;
  return {
    question,
    status: res.status,
    firstWordsSeconds: first == null ? null : +(first / 1000).toFixed(2),
    totalSeconds: +(total / 1000).toFixed(2),
    engine: final?.engine ?? null,
    answer: final?.answer ?? null,
    cards: (final?.relatedDocuments ?? []).length,
    citations: (final?.citations ?? []).length,
  };
}

const results = [];
for (const q of questions) {
  try {
    results.push(await ask(q));
  } catch (e) {
    results.push({ question: q, error: String(e).slice(0, 200) });
  }
}
const text = JSON.stringify({ base, at: new Date().toISOString(), results }, null, 2);
if (out) (await import('node:fs')).writeFileSync(out, text);
for (const r of results) console.log(`${r.totalSeconds ?? '-'}s total, ${r.firstWordsSeconds ?? '-'}s to first words | ${r.engine} | ${r.question}`);
