param(
  [string]$Root = "F:\1_A_Disk_D\TT",
  [string]$RepoUrl = "https://github.com/minhmannguyengdp-sketch/japan-underwear.git",
  [string]$Branch = "feat/catalog-variant-ordering-ui"
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  throw "Git chưa được cài hoặc chưa có trong PATH."
}

if (-not (Test-Path -LiteralPath $Root)) {
  New-Item -ItemType Directory -Path $Root -Force | Out-Null
}

$gitDirectory = Join-Path $Root ".git"

if (-not (Test-Path -LiteralPath $gitDirectory)) {
  $existingItems = @(Get-ChildItem -LiteralPath $Root -Force)

  if ($existingItems.Count -gt 0) {
    throw "Thư mục $Root đang có dữ liệu nhưng chưa phải Git repository. Hãy đổi tên thư mục hiện tại, chạy lại script để clone code, rồi chuyển ảnh vào local-assets/catalog/."
  }

  git clone --branch $Branch --single-branch $RepoUrl $Root
  if ($LASTEXITCODE -ne 0) {
    throw "Không clone được repository."
  }
}

Set-Location -LiteralPath $Root

$originUrl = git remote get-url origin 2>$null
if ($LASTEXITCODE -ne 0) {
  git remote add origin $RepoUrl
} elseif ($originUrl.Trim() -ne $RepoUrl) {
  git remote set-url origin $RepoUrl
}

if ($LASTEXITCODE -ne 0) {
  throw "Không cấu hình được remote origin."
}

git fetch origin
if ($LASTEXITCODE -ne 0) {
  throw "Không fetch được repository."
}

git show-ref --verify --quiet "refs/heads/$Branch"
if ($LASTEXITCODE -eq 0) {
  git checkout $Branch
} else {
  git checkout -b $Branch --track "origin/$Branch"
}

if ($LASTEXITCODE -ne 0) {
  throw "Không checkout được branch $Branch."
}

git pull --ff-only origin $Branch
if ($LASTEXITCODE -ne 0) {
  throw "Không pull được branch $Branch theo fast-forward."
}

$localDirectories = @(
  "local-assets/catalog/winking",
  "local-assets/catalog/pensee",
  "imports/images",
  "data/local"
)

foreach ($directory in $localDirectories) {
  New-Item -ItemType Directory -Path (Join-Path $Root $directory) -Force | Out-Null
}

git check-ignore -q "local-assets/catalog"
if ($LASTEXITCODE -ne 0) {
  throw "local-assets/catalog chưa được .gitignore bảo vệ. Không chép ảnh vào cho tới khi sửa xong."
}

Write-Host ""
Write-Host "Đã kết nối local với GitHub:" -ForegroundColor Green
Write-Host "  Repo:   $RepoUrl"
Write-Host "  Branch: $Branch"
Write-Host "  Root:   $Root"
Write-Host ""
Write-Host "Ảnh local đặt tại:" -ForegroundColor Cyan
Write-Host "  $Root\local-assets\catalog\winking\9090\"
Write-Host "  $Root\local-assets\catalog\pensee\9502\"
Write-Host ""
Write-Host "Các thư mục này đã bị Git bỏ qua và sẽ không được push lên GitHub." -ForegroundColor Yellow
Write-Host "Kiểm tra bằng: git status --short --ignored"
