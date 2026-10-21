# India Options Lab

A simple browser research workbench for European Indian equity options. Estimates a time-dependent IV curve from other liquid options on the same equity, excludes the target and its call/put counterpart, and compares analytical pricing with Milstein Monte Carlo.

[Open the workbench](https://yohanntalib-hub.github.io/india-options-lab/) · [Read the methodology](https://yohanntalib-hub.github.io/india-options-lab/methodology.html)

The public demo opens with clearly labelled synthetic quotes. It needs no login or API key to explore the pricing method. Live quotes require the visitor's own valid Upstox Analytics Token.

## Publication

The website is hosted on GitHub Pages. The `Test and publish website` workflow runs the numerical and adapter tests before publishing `dist/` on each push to `main`. In repository Settings → Pages, the source is GitHub Actions. No deployment secrets are required. The former local `.openai/` hosting metadata is excluded from this repository.

## Run locally

Requires Node.js 20 or later. No package installation or build step is required.

```powershell
node server.mjs
```

Open http://127.0.0.1:8765. Stop with Ctrl+C. A static host can serve `dist/`; only the local server offers `/api/rates`.

```powershell
node --test tests/*.test.mjs
node scripts/refresh-rates.mjs
```

The second command fetches CCIL's latest published NSS row and replaces `dist/rates.json`. Review the date and rate convention before using it. Deploy again to update a hosted static copy. No daily scheduler has been configured.

## Using the workbench

1. Start with the explicitly synthetic demonstration. Choose equity, expiry, call/put and strike.
2. Inspect the model estimate, volatility nodes and held-out calibration audit. Prices are INR per underlying unit.
3. Enter an explicit dividend assumption. Inspect rate source, observation date and compounding convention.
4. Run Milstein with 5,000–50,000 paths. Inspect sampling interval and coupled half-step change.
5. Export a quote snapshot or research run as JSON for replay. Import a snapshot to reproduce its valuation timestamp.
6. For market data, choose **Connect market data** and enter an Upstox Analytics Token in the page itself. Do not put it in source files, exports or chat. Account permissions and provider coverage apply. Tokens remain only in tab memory; disconnect or reload clears them.

The live adapter dynamically discovers optionable equities in NSE/BSE instrument files, loads up to six expiries and subscribes to up to 1,000 instruments. Lack of enough liquid options produces an explicit data error, not an invented volatility estimate. REST timestamps are receipt times, not verified exchange book times. Reconnect/refresh manually if the socket closes. Authenticated end-to-end live data has not been tested because no token was supplied.

## Model and limitations

Read [the full methodology](dist/methodology.html), also linked in the app. Key assumptions:

- Deterministic rate and volatility maturity curves; European exercise; constant continuous dividend yield.
- ACT/365 fractional maturity and assumed standard 15:30 IST expiry time.
- CCIL NSS supplies a fitted government-bond curve; short-end daily values are interpolated/modelled yields, not daily-tenor observations. Its compounding convention is explicitly unconfirmed; continuous is provisional.
- Near-forward IV weights favour close strikes and narrow spreads. Total variance is fitted nondecreasing, then linearly interpolated. This is not a complete volatility surface and far strikes may be poorly represented.
- No beyond-last-expiry extrapolation; at least two supported maturities with three distinct strikes each.
- Milstein simulations have coupled coarse/half-step grids, antithetic sampling, seeded reproducibility and pair-based standard errors. Confidence intervals measure sampling uncertainty only.
- Demo option quotes, stock prices and contract dates are synthetic, frozen at 16 October 2026 10:00 IST. The bundled CCIL parameters are a separate dated market input from 15 October 2026.
- Corporate actions, discrete dividends, funding/collateral spreads, exceptional settlement and full smile/skew calibration remain outside this first version.

Automated tests establish implementation consistency. They do not establish live market pricing accuracy. The natural next research step is validation on saved real option-chain snapshots, reporting held-out errors relative to bid/ask spreads and by maturity/moneyness.

## JSON formats

The simplest way to create a valid snapshot is **Export quote snapshot** in the demonstration. A wrapper contains `snapshot`, `rates`, `dividend` (decimal annual yield) and `targetId`.

`snapshot` includes `symbol`, `exchange` (`NSE`/`BSE`), positive `spot`, ISO `asOf`, `source`, `synthetic`, and `quotes`. Each quote has a unique `id`, `expiry` (`YYYY-MM-DD`), `strike`, `type` (`call`/`put`), `bid`, `ask`, `bidQty`, `askQty`, `oi`, `volume`, ISO `quoteTime` and `timestampBasis`. `ltp` and `lotSize` are optional display metadata. Prices/strikes are per underlying unit.

Custom rate JSON uses percentage points (5.5 means 5.5%):

```json
{
  "source": "User research curve — replace with the actual source",
  "asOf": "2026-10-15",
  "compounding": "continuous",
  "points": [
    {"days": 7, "ratePct": 5.3},
    {"days": 30, "ratePct": 5.4},
    {"days": 90, "ratePct": 5.6},
    {"days": 180, "ratePct": 5.8}
  ]
}
```

Conventions: `continuous`, `annual`, `semiannual`, `simple`. Alternatively provide the six NSS fields in `nss`: `beta0`–`beta3` in percentage points and `tau1`, `tau2` in years. Points must be increasing and cover relevant maturities. Imported data provenance is not independently verified.

## Files

- `dist/pricing.js`: calibration, rate/variance curves, analytic formula, Milstein engine.
- `dist/live.js`: Upstox REST adapter and official protobuf feed decoder.
- `dist/app.js`, `index.html`, `styles.css`: browser interface.
- `dist/worker.js`: Monte Carlo worker.
- `dist/demo.js`: synthetic quote generator.
- `scripts/refresh-rates.mjs`: public CCIL parameter parser.
- `tests/`: numerical and adapter fixtures; no real credentials.
- `dist/vendor/`: protobuf.js, licence and original official feed schema.

Market source terms continue to apply. Publishing this research code does not grant rights to redistribute exchange data commercially. The public demo contains synthetic option quotes; users retrieve live quotes directly from their own provider connection.
