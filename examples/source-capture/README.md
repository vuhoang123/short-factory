# Owned synthetic source screenshots

Original Vietnamese text, fictional author names and HTML were authored by this project for tests. No real Facebook/Threads user data or account was used. The engine captured the actual DOM pixels, including reaction strips, rather than constructing cards in the video renderer.

`capture.json` and its 12 PNGs are an immutable fixture for API/worker/renderer regression tests. `scripts/smoke-source-capture.py` independently recreates the page and checks screenshots in ignored `test-results/source-capture/`; it never replaces these checked-in fixture files automatically.
