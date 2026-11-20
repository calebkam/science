# Publishing to GitHub

1. Create an empty repository on GitHub (no README, no licence, so nothing conflicts), for example `science`.
2. In this folder:
   ```
   git init -b main
   git add .
   git commit -m "Lab Tools: Bondline, Bondline Dock, Positioning Kit, Brain Matrix"
   git remote add origin https://github.com/<your-user>/science.git
   git push -u origin main
   ```
3. On GitHub: Settings → Pages → Build and deployment → Source "Deploy from a branch" → Branch `main`, folder `/ (root)` → Save.
4. Wait a minute or two. The site appears at `https://<your-user>.github.io/science/`.
5. Edit `LICENSE` (your name) and the GitHub link in the footer of `index.html`, then commit and push.

Check after publishing: open the home page, then each tool; switch theme; in Dock press "Load example"; in Brain Matrix confirm the 3D model appears (it loads `manifold.wasm`).
