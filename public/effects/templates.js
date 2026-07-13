/**
 * Profile Effects HTML Templates
 * Save these to public/effects/ directory
 */

// cherry-blossoms.html
const cherryBlossoms = `
<!DOCTYPE html>
<html>
<head>
  <style>
    * { margin: 0; padding: 0; }
    body { background: transparent; overflow: hidden; }
    @keyframes drift {
      0% { transform: translateX(0) translateY(0) rotate(0deg); opacity: 1; }
      100% { transform: translateX(100px) translateY(200px) rotate(360deg); opacity: 0; }
    }
    .petal {
      position: absolute;
      width: 10px;
      height: 10px;
      background: radial-gradient(circle, rgba(255, 192, 203, 1), rgba(255, 192, 203, 0));
      border-radius: 50%;
      animation: drift 8s ease-in infinite;
      box-shadow: 0 0 10px rgba(255, 182, 193, 0.8);
    }
  </style>
</head>
<body>
  <script>
    const container = document.body;
    for (let i = 0; i < 15; i++) {
      const petal = document.createElement('div');
      petal.className = 'petal';
      petal.style.left = Math.random() * 100 + '%';
      petal.style.top = Math.random() * 100 + '%';
      petal.style.animationDelay = Math.random() * 8 + 's';
      petal.style.width = (Math.random() * 8 + 5) + 'px';
      petal.style.height = petal.style.width;
      container.appendChild(petal);
    }
  </script>
</body>
</html>
`

// digital-rain.html
const digitalRain = `
<!DOCTYPE html>
<html>
<head>
  <style>
    * { margin: 0; padding: 0; }
    body { background: transparent; overflow: hidden; font-family: monospace; }
    @keyframes rain {
      0% { transform: translateY(-100%); }
      100% { transform: translateY(100vh); }
    }
    .rain-char {
      position: absolute;
      color: rgba(0, 255, 0, 0.7);
      animation: rain 3s linear infinite;
      font-size: 16px;
      text-shadow: 0 0 10px rgba(0, 255, 0, 0.8);
      font-weight: bold;
    }
  </style>
</head>
<body>
  <script>
    const chars = '01アイウエオカキクケコサシスセソタチツテト';
    const container = document.body;
    for (let i = 0; i < 20; i++) {
      const char = document.createElement('div');
      char.className = 'rain-char';
      char.textContent = chars[Math.floor(Math.random() * chars.length)];
      char.style.left = Math.random() * 100 + '%';
      char.style.animationDelay = Math.random() * 3 + 's';
      container.appendChild(char);
    }
  </script>
</body>
</html>
`

// ember-glow.html
const emberGlow = `
<!DOCTYPE html>
<html>
<head>
  <style>
    * { margin: 0; padding: 0; }
    body { background: transparent; overflow: hidden; }
    @keyframes glow {
      0%, 100% { opacity: 0.5; transform: scale(1); }
      50% { opacity: 1; transform: scale(1.2); }
    }
    .ember {
      position: absolute;
      width: 30px;
      height: 30px;
      background: radial-gradient(circle, rgba(255, 165, 0, 1), rgba(255, 69, 0, 0.5), rgba(255, 0, 0, 0));
      border-radius: 50%;
      animation: glow 3s ease-in-out infinite;
      box-shadow: 0 0 30px rgba(255, 100, 0, 0.8);
    }
  </style>
</head>
<body>
  <script>
    const container = document.body;
    for (let i = 0; i < 8; i++) {
      const ember = document.createElement('div');
      ember.className = 'ember';
      ember.style.left = Math.random() * 100 + '%';
      ember.style.top = Math.random() * 100 + '%';
      ember.style.animationDelay = Math.random() * 3 + 's';
      container.appendChild(ember);
    }
  </script>
</body>
</html>
`

export { cherryBlossoms, digitalRain, emberGlow }
