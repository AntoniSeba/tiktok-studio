// analysis.js — turn raw stats into "what's winning" intelligence.
// Groups posted videos by each experimental factor (hook, wizual, glos, tempo,
// temat, cta, cat) and ranks the values by average performance, so you know
// which creative choices to repeat.
import { listVideos } from './db.js';

const FACTORS = ['hook', 'wizual', 'glos', 'tempo', 'temat', 'cta', 'cat'];

// Engagement score blends reach + retention + action. Tunable weights.
function score(v) {
  const views = Number(v.views) || 0;
  const completion = Number(v.completion) || 0;        // %
  const engage = (Number(v.likes) + Number(v.saves) * 2 + Number(v.shares) * 3 + Number(v.comments) * 2);
  const engRate = views > 0 ? (engage / views) * 100 : 0;
  // weighted: retention matters most for the algorithm, then engagement rate, then raw reach
  return completion * 6 + engRate * 4 + Math.log10(views + 1) * 10;
}

export function analyze() {
  const all = listVideos();
  const posted = all.filter(v => v.posted && (v.views > 0 || v.completion > 0));

  const perFactor = {};
  for (const f of FACTORS) {
    const buckets = {};
    for (const v of posted) {
      const key = (v[f] || '—').trim() || '—';
      (buckets[key] ||= []).push(v);
    }
    perFactor[f] = Object.entries(buckets).map(([value, vids]) => {
      const n = vids.length;
      const avg = (sel) => vids.reduce((a, b) => a + (Number(b[sel]) || 0), 0) / n;
      return {
        value,
        n,
        avgViews: Math.round(avg('views')),
        avgCompletion: +avg('completion').toFixed(1),
        avgLikes: Math.round(avg('likes')),
        score: +(vids.reduce((a, b) => a + score(b), 0) / n).toFixed(1)
      };
    }).sort((a, b) => b.score - a.score);
  }

  // Top + bottom performing individual videos
  const ranked = posted
    .map(v => ({ id: v.id, title: v.title, views: v.views, completion: v.completion, score: +score(v).toFixed(1) }))
    .sort((a, b) => b.score - a.score);

  // Human-readable recommendations: best value per factor with >=2 samples
  const recommendations = [];
  for (const f of FACTORS) {
    const ranked2 = perFactor[f].filter(b => b.n >= 2);
    if (ranked2.length) {
      const win = ranked2[0];
      recommendations.push({
        factor: f,
        winner: win.value,
        detail: `śr. ${win.avgViews} wyśw. · ${win.avgCompletion}% do końca · score ${win.score} (n=${win.n})`
      });
    }
  }

  return {
    sampleSize: posted.length,
    totalVideos: all.length,
    perFactor,
    top: ranked.slice(0, 5),
    bottom: ranked.slice(-3).reverse(),
    recommendations
  };
}
