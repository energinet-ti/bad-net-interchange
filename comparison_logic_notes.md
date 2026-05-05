# Comparison Logic Notes

## What Was Copied From cgma-igm-comparison-ui-app

The Python script now supports the same core CGMA logic used in the reference project:

1. **Reference CGMA mode (B65)**
   - Parses `TimeSeries` with `businessType = B65`.
   - Uses `in_Domain.mRID` and `out_Domain.mRID` to classify import/export.
   - Computes timestamp as:
     - `periodStart + (position - 1) * resolution`
   - Computes net position as:
     - `import - export`

2. **Inhouse CGMA mode (NP-DKx-IM/EX)**
   - Parses `TimeSeries id="NP-DKx-IM/EX..."` with `Data dt/qty` points.
   - Computes net position using selected sign convention.

The script auto-detects parser path and prints which one was used.

## Time Alignment Used Here (Why 24 points)

In this dataset:

- SSH timestamps are half-hour values from:
  - `2026-05-04T22:30Z` to `2026-05-05T21:30Z`
- CGMA timestamps are whole-hour values from:
  - `2026-05-05T22:00Z` to `2026-05-06T21:00Z`

Direct overlap is `0`.

The script auto-detects the best shift and applies:

- **SSH shift = +1410 minutes**

That produces full overlap:

- **24 matched timestamps out of 24**

## Why Values Can Still Differ

Even with correct time alignment, large differences may remain if the two files are not from the same operational run/version basis or if they use different balancing-area net definitions.

In this specific sample, timestamp alignment is correct, but value ranges still indicate a data-definition/run-pair mismatch rather than a clock mismatch.

## How To Run

```bash
/usr/local/bin/python3 compare_igm_vs_cgma.py --ssh-time-shift-minutes auto --export-plots --plots-dir plots
```

Outputs:

- `comparison_result.md`
- `plots/comparison_DK1.png`
- `plots/comparison_DK2.png`
