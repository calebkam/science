# Publishing to GitHub (website only, no terminal)

1. On github.com choose **New repository**. Name it, for example, `lab-tools-3d`. Leave "Add a README" unticked.
2. On the empty repository page choose **uploading an existing file**.
3. Unzip the download on your computer, open the unzipped folder and drag its **contents** (`index.html`, the `positioning-kit`, `brain-matrix`, `slicer`, `changelog` and `shared` folders and the other files) into the browser window. Folders upload with their files. Do not drag the outer folder itself, because `index.html` must sit at the top of the repository.
4. Choose **Commit changes**.
5. Open **Settings → Pages → Build and deployment**, set Source to "Deploy from a branch", Branch `main`, folder `/ (root)`, and Save.
6. After a minute or two the site is at `https://<your-user>.github.io/<repo>/`.
7. Edit `LICENSE` (your name) and the GitHub link in the footer of `index.html` with the pencil icon, then commit.

Updating later: open the file on GitHub, choose the pencil, or use **Add file → Upload files** and drop the changed files (keep their folders) to replace them.

Check after publishing: open the home page, then each tool; switch theme; in Brain Matrix confirm the 3D model appears (it loads `manifold.wasm`).
