@echo off
cd /d %~dp0
where node >nul 2>nul || (
  echo Node.js nao foi encontrado. Instale o Node.js 20 ou superior.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Instalando dependencias...
  call npm install
)
echo.
echo CAOS CORD iniciando em http://localhost:3000
start http://localhost:3000
npm start
pause
