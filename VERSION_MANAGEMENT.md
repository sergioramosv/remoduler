# Sistema de Versionado Automático

Remoduler utiliza **Semantic Release** con **Conventional Commits** para versionado automático y changelog generado automáticamente.

## ¿Cómo Funciona?

### 1. Formato de Commits (Conventional Commits)

Todos los commits deben seguir este formato:

```
<tipo>(<scope>): <descripción>
```

#### Tipos válidos:

| Tipo | Descripción | Impacto en Versión | Ejemplo |
|------|-------------|-------------------|---------|
| `feat` | Nueva característica | MINOR ↑ | `feat: add dark mode` |
| `fix` | Corrección de bug | PATCH ↑ | `fix: resolve login issue` |
| `docs` | Cambios en documentación | (no incrementa) | `docs: update README` |
| `style` | Cambios de formato | (no incrementa) | `style: format code` |
| `refactor` | Refactorización | (no incrementa) | `refactor: simplify logic` |
| `perf` | Mejora de performance | PATCH ↑ | `perf: optimize queries` |
| `test` | Agregar/modificar tests | (no incrementa) | `test: add unit tests` |
| `build` | Cambios en build o deps | (no incrementa) | `build: update webpack` |
| `ci` | Cambios en CI/CD | (no incrementa) | `ci: add GitHub Actions` |
| `chore` | Cambios misceláneos | (no incrementa) | `chore: update deps` |

#### Breaking Changes (MAJOR):

```bash
# Con ! después del tipo
git commit -m "feat!: redesign authentication flow"

# O con footer BREAKING CHANGE
git commit -m "feat: change API endpoint

BREAKING CHANGE: old endpoint /api/v1 is deprecated"
```

### 2. Flujo Automático en GitHub

Cuando se hace **push a `main`**:

1. **GitHub Actions** ejecuta el workflow `release.yml`
2. **Semantic Release** analiza commits desde la última versión
3. **Calcula nueva versión**:
   - `feat:` → MINOR (1.0.0 → 1.1.0)
   - `fix:` o `perf:` → PATCH (1.0.0 → 1.0.1)
   - `feat!:` o `BREAKING CHANGE:` → MAJOR (1.0.0 → 2.0.0)
4. **Actualiza automáticamente**:
   - `package.json` con nueva versión
   - `CHANGELOG.md` con notas de release
   - Git tags (ej: `v1.2.3`)
   - GitHub Releases

### 3. Validación de Commits

`.commitlintrc.json` valida el formato de commits:

```bash
git commit -m "invalid message"
# ✘ Error: commit message must be conventional

git commit -m "feat: add new agent"
# ✓ OK
```

## Configuración

### `.releaserc.json`
- Branches: main (releases) y develop (pre-releases)
- Plugins: commit-analyzer, release-notes, changelog, npm, git, github

### `.github/workflows/release.yml`
- Se ejecuta en push a main/develop
- Ejecuta semantic-release con GITHUB_TOKEN

### `.commitlintrc.json`
- Valida formato conventional commits
- Header max 100 caracteres

## Flujo Ejemplo

```bash
# 1. Desarrollo
git checkout -b feat/new-agent

# 2. Commit convencional
git commit -m "feat(agents): add memory agent for pattern tracking"

# 3. Push + PR
git push origin feat/new-agent
gh pr create --title "feat: add memory agent"

# 4. Merge a main → GitHub Actions automáticamente:
#    - Detecta "feat:" → MINOR: 1.0.0 → 1.1.0
#    - Actualiza package.json
#    - Genera CHANGELOG.md
#    - Crea tag v1.1.0
#    - Crea GitHub Release
```

## Importante para el desarrollo

- **SIEMPRE** usar conventional commits
- **NUNCA** commitear .env o serviceAccountKey.json
- **NUNCA** añadir Co-Authored-By trailers
- Los scopes opcionales útiles: `agents`, `cycle`, `prompts`, `mcp`, `cli`, `state`
