# Chinese typography

`AlibabaPuHuiTi-3-55-Regular.ttf` and `AlibabaPuHuiTi-3-65-Medium.ttf` are the
original, unchanged Alibaba PuHuiTi files supplied for this project (local,
ignored authoring inputs, no longer tracked). Both
bundled optical faces now derive from **Medium**. English and numbers use the
LCARS 26 Antonio Regular/Bold WOFF2 assets, including Bold for titles.

`AlibabaPuHuiTi-LCARS-Regular.ttf` pairs Medium outlines with Antonio Regular
at CSS weight 400. `AlibabaPuHuiTi-LCARS-Bold.ttf` pairs calibrated Medium
outlines with Antonio Bold at CSS weight 700. These are two explicit static
faces; browser font synthesis is disabled globally. The former single Regular
file declared as a 400–700 range silently left Chinese titles much thinner
than the English Bold face.

Both faces normalize Chinese cap height and alphabetic baseline. Bold uses
Skia PathOps outline stroke/union with independently calibrated x/y growth,
matching the vertical and horizontal reference strokes of Antonio H to
PuHuiTi 日. Calibration accounts for subsequent vertical normalization.
Advances and kerning remain unchanged; side bearings follow grown outlines to
preserve glyph origins. Original licensing/copyright metadata is preserved;
obsolete hints and signatures are removed from the derivatives only.

Ordinary `npm run build`, full/shallow clones and offline Electron launches
use the four explicitly allowlisted runtime font assets. They do not need
Python, downloads, the original TTFs or the LCARS template archive.

To regenerate the runtime assets:

```sh
npm run fonts:source
python -m pip install -r fonts/requirements.txt
python scripts/normalize-lcars-font.py
```

The script validates the saved integer-rounded stroke geometry within 10% of
each reference and writes `.test-data/fonts/optical-metrics.json`. FontTools and Skia PathOps
are development asset-authoring dependencies; `npm build` and Electron need
neither Python nor those packages. Both fonts load locally offline.

Original file SHA-256:

- Regular: `BE33BC8D45CED30FA5C542F6F056565BAF85003D4E079522110D76016F8A04E2`
- Medium: `D92B378A2D08AC1E5C2B87D03B9939FDFAE93D3C336B6A13AC4E00CE44F6DB9E`

`fonts:source` verifies an existing local Medium without overwriting it. If
absent, it restores the exact originally supplied blob
`38ee60f77e5c1f6db437e63c31b43a654fa4e231` from the unchanged Git history and
checks SHA-256 before writing. A shallow clone must first obtain full history
(`git fetch --unshallow`) for authoring. Regular is not used by the generator.
This is an offline, pinned recovery procedure, not an unverified third-party
font download. Generated runtime faces retain the original copyright records;
the script renames the derivative faces and preserves glyph coverage.

Antonio's SIL OFL notice is retained in `docs/ANTONIO-OFL.txt`. PuHuiTi retains
“Copyright © 2020-2023 Alibaba (China) Co., Ltd. All rights reserved.” Official
font distribution and legal statement are at
https://www.alibabafonts.com/ and
https://www.yuque.com/yiguang-wkqc2/puhuiti/nus9wiinq4aeiegy .
The supplied PuHuiTi source has no embedded license text (name IDs 13/14);
this cleanup preserves existing runtime assets and copyright metadata and
does not relabel them as OFL/Apache or infer additional distribution rights.

Electron verification checks the exact Regular/Bold platform font names,
painted glyph bounds, antialiased reference stroke coverage, and screenshots
at 125%, 150% and 200% display scaling. It also checks all shared title bars
for uniform butterscotch ends with zero border widths. Equal CSS font size or
glyph height alone does not verify mixed-script weight.
