# AFTER SIGNAL

Play: https://comicman081-collab.github.io/aftersignal/

Current PC browser first draft, with Korean captions and Korean/Japanese voices.

GitHub Pages publishes `main` directly with `.nojekyll`; Actions are disabled and artifact/log retention is one day. No build artifact, diagnostic screen, old character candidate or duplicate standalone bundle is published.

All 40 characters use the current modular motion assets. Standing artwork and live-2D masks retain their original bytes. Runtime images use WebP quality 95 with exact alpha/dimensions; below 36 dB visible RGB PSNR they use lossless WebP. PCM sound effects use lossless FLAC and were decoded back to identical PCM samples; music, voices and video retain their original bytes. The deployment is an online HTTP/HTTPS package; local file-protocol embed bundles remain in the original development RUN.
