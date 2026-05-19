import React, { useEffect, useRef, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Play, Volume2, VolumeX } from 'lucide-react';

interface RunnerGameProps {
  dinoType: "Speedy" | "Tank" | "Balanced" | "Agile";
  dinoImage: string;
  dinoDiet?: string;
  onGameEnd: (score: number, coins: number, won: boolean, speed: number) => void;
}

export const RunnerGame: React.FC<RunnerGameProps> = ({ dinoType, dinoImage, dinoDiet, onGameEnd }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [timeLeft, setTimeLeft] = useState(10);
  const [score, setScore] = useState(0);
  const [coins, setCoins] = useState(0);
  const [gameStarted, setGameStarted] = useState(false);
  const [isGameOver, setIsGameOver] = useState(false);
  const [isMuted, setIsMuted] = useState(false);

  // Game constants based on dino type - memoized to prevent effect re-runs
  const stats = useMemo(() => ({
    Speedy: { speed: 7, jump: 14, health: 1 },
    Tank: { speed: 5, jump: 11, health: 3 },
    Balanced: { speed: 6, jump: 12, health: 2 },
    Agile: { speed: 6.5, jump: 16, health: 1.5 },
  })[dinoType], [dinoType]);

  // Audio refs
  const bgMusic = useRef<HTMLAudioElement | null>(null);
  const jumpSound = useRef<HTMLAudioElement | null>(null);
  const coinSound = useRef<HTMLAudioElement | null>(null);
  const bumpSound = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    // Initialize audio
    // Using a fast-paced, bouncy circus-style chiptune track
    bgMusic.current = new Audio('track1.mp3');
    bgMusic.current.loop = true;
    bgMusic.current.volume = 0.3;

    jumpSound.current = new Audio('jump.mp3'); // Short jump/blip sound
    jumpSound.current.volume = 0.2;

    coinSound.current = new Audio('coin.wav'); // Coin collect sound
    coinSound.current.volume = 0.4;

    bumpSound.current = new Audio('bump.mp3'); // Obstacle hit sound
    bumpSound.current.volume = 0.5;

    return () => {
      if (bgMusic.current) {
        bgMusic.current.pause();
        bgMusic.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (bgMusic.current) {
      bgMusic.current.muted = isMuted;
    }
    if (jumpSound.current) {
      jumpSound.current.muted = isMuted;
    }
    if (coinSound.current) {
      coinSound.current.muted = isMuted;
    }
    if (bumpSound.current) {
      bumpSound.current.muted = isMuted;
    }
  }, [isMuted]);

  useEffect(() => {
    if (gameStarted && !isGameOver) {
      bgMusic.current?.play().catch(e => console.log("Audio play blocked:", e));
    } else {
      bgMusic.current?.pause();
    }
  }, [gameStarted, isGameOver]);

  useEffect(() => {
    if (!gameStarted || isGameOver) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    let animationFrameId: number;
    let frameCount = 0;
    // Fixed-step accumulator: physics & gameplay step at exactly 60Hz regardless of monitor refresh.
    const FIXED_DT = 1 / 60;
    let accumulator = 0;

    // Game state (mutable refs for performance and to avoid re-renders during loop)
    const player = {
      x: 40,
      y: canvas.height - 120,
      width: 50,
      height: 50,
      dy: 0,
      jumpPower: stats.jump,
      gravity: 0.7,
      isGrounded: false,
      health: stats.health,
    };

    const obstacles: any[] = [];
    const collectables: any[] = [];
    const holes: any[] = [];

    // Background scenery pre-population
    const clouds: any[] = Array.from({ length: 4 }).map(() => ({
      x: Math.random() * canvas.width,
      y: 20 + Math.random() * 80,
      width: 40 + Math.random() * 50,
      speed: 0.2 + Math.random() * 0.3
    }));
    const trees: any[] = Array.from({ length: 6 }).map(() => ({
      x: Math.random() * canvas.width,
      y: canvas.height - 40,
      height: 40 + Math.random() * 60,
      width: 20 + Math.random() * 20,
      speed: (stats.speed + 1) * 0.4
    }));
    let gameScore = 0;
    let gameCoins = 0;
    let gameTime = 10;
    let lastTime = performance.now();

    const dinoImg = new Image();
    dinoImg.src = dinoImage;

    // 1. Math for safe jumping based on this dinosaur's unique stats
    const gravity = 0.7;
    const jumpPower = stats.jump;
    const obsSpeed = stats.speed + 1;

    // Vertical safe height (h = v^2 / 2g)
    const trueMaxJumpHeight = (jumpPower * jumpPower) / (2 * gravity);
    // Horizontal safe width (distance = time * speed, time = 2 * (v/g))
    const jumpTime = 2 * (jumpPower / gravity);
    const horizontalJumpDistance = jumpTime * obsSpeed;

    const spawnObstacle = () => {
      // 1. Math for safe jumping based on this dinosaur's unique stats
      const gravity = 0.7;
      const jumpPower = stats.jump;
      const obsSpeed = stats.speed + 1;

      // Vertical safe height (h = v^2 / 2g)
      const trueMaxJumpHeight = (jumpPower * jumpPower) / (2 * gravity);
      // Horizontal safe width (distance = time * speed, time = 2 * (v/g))
      const jumpTime = 2 * (jumpPower / gravity);
      const horizontalJumpDistance = jumpTime * obsSpeed;

      // Prevent impossible traps: do not spawn a bush if a pothole is too close
      if (holes.length > 0) {
        const lastHole = holes[holes.length - 1];
        if (canvas.width - lastHole.x < horizontalJumpDistance * 1.8) {
          return;
        }
      }
      // Also prevent bushes from spawning too close to each other
      if (obstacles.length > 0) {
        const lastObs = obstacles[obstacles.length - 1];
        if (canvas.width - lastObs.x < horizontalJumpDistance * 1.2) {
          return;
        }
      }

      // 2. Scale obstacle uniquely to fit within safe margins
      // Cap height to 50% of their actual jump, maxing at 50px
      const obsHeight = Math.min(50, Math.max(15, trueMaxJumpHeight * 0.5));
      // Cap width to 35% of their horizontal distance, maxing out around 50px
      const bushWidth = Math.max(20, Math.min(50, horizontalJumpDistance * 0.35));

      // Generate a unique leafy structure for this bush
      const leaves = Array.from({ length: 3 + Math.floor(Math.random() * 4) }).map(() => ({
        ox: Math.random() * bushWidth,
        oy: Math.random() * (obsHeight / 1.5),
        r: 10 + Math.random() * 12,
      }));
      // Pick a random shade of green
      const colors = ['#3CB371', '#228B22', '#2E8B57', '#32CD32'];
      const bushColor = colors[Math.floor(Math.random() * colors.length)];

      obstacles.push({
        x: canvas.width,
        y: canvas.height - 40 - obsHeight,
        width: bushWidth,
        height: obsHeight,
        speed: obsSpeed,
        leaves,
        bushColor
      });
    };

    const spawnCoin = () => {
      // Prevent treats from baiting players into potholes
      if (holes.length > 0) {
        const lastHole = holes[holes.length - 1];
        if (canvas.width - lastHole.x < horizontalJumpDistance * 1.5) {
          return;
        }
      }

      // Coins will predictably spawn within jump reach (up to 95% of max jump height, min 50px high)
      const randomYReach = 50 + Math.random() * (trueMaxJumpHeight * 0.95 - 50);
      collectables.push({
        x: canvas.width,
        y: canvas.height - 40 - randomYReach - 25, // -25 for coin height itself
        width: 25,
        height: 25,
        speed: obsSpeed,
      });
    };

    const spawnHole = () => {
      // Prevent impossible traps: do not spawn a pothole if a bush is too close
      if (obstacles.length > 0) {
        const lastObs = obstacles[obstacles.length - 1];
        if (canvas.width - lastObs.x < horizontalJumpDistance * 1.8) {
          return;
        }
      }
      // Prevent potholes from spawning too close to each other
      if (holes.length > 0) {
        const lastHole = holes[holes.length - 1];
        if (canvas.width - lastHole.x < horizontalJumpDistance * 2.0) {
          return;
        }
      }

      holes.push({
        x: canvas.width,
        width: 80 + Math.random() * 50, // 80 to 130px wide
        speed: stats.speed + 1,
      });
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.code === 'Space' || e.code === 'ArrowUp') && player.isGrounded) {
        player.dy = -player.jumpPower;
        player.isGrounded = false;
        jumpSound.current?.play().catch(() => { });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    // Also support touch/click for mobile
    const handleTouch = () => {
      if (player.isGrounded) {
        player.dy = -player.jumpPower;
        player.isGrounded = false;
        jumpSound.current?.play().catch(() => { });
      }
    };
    canvas.addEventListener('touchstart', handleTouch);
    canvas.addEventListener('mousedown', handleTouch);

    let isFlickering = false;
    let flickerTimer = 0;

    const gameLoop = (time: number) => {
      // Fixed-step accumulator. Each real frame, we accumulate elapsed wall-clock time
      // and run as many 1/60s simulation steps as fit. This decouples gameplay speed
      // from monitor refresh rate (60Hz, 120Hz ProMotion, 144Hz, etc. all play identically).
      const rawDelta = (time - lastTime) / 1000;
      // Cap accumulator growth so a backgrounded tab can't spawn a long catch-up burst.
      accumulator += Math.min(rawDelta, 0.25);
      lastTime = time;

      // Run zero or more fixed-step ticks. The body of stepFrame below is the original
      // per-frame logic, unchanged — it still assumes 1 call == 1/60 s of game time.
      while (accumulator >= FIXED_DT) {
        accumulator -= FIXED_DT;
        const deltaTime = FIXED_DT;
        const done = stepFrame(deltaTime);
        if (done) return;
      }

      animationFrameId = requestAnimationFrame(gameLoop);
    };

    const stepFrame = (deltaTime: number): boolean => {
      gameTime -= deltaTime;

      if (isFlickering) {
        flickerTimer -= deltaTime;
        if (flickerTimer <= 0) isFlickering = false;
      }

      // Update UI state less frequently or at specific intervals
      if (Math.ceil(gameTime) !== timeLeft) {
        setTimeLeft(Math.max(0, Math.ceil(gameTime)));
      }

      if (gameTime <= 0) {
        endGame(true); // Survived the timer! Win condition!
        return true;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Background (Sky)
      ctx.fillStyle = '#87CEEB';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Clouds
      if (frameCount % 180 === 0) {
        clouds.push({ x: canvas.width + 50, y: 20 + Math.random() * 80, width: 40 + Math.random() * 50, speed: 0.2 + Math.random() * 0.3 });
      }
      ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
      for (let i = clouds.length - 1; i >= 0; i--) {
        const c = clouds[i];
        c.x -= c.speed;
        ctx.beginPath();
        ctx.arc(c.x, c.y, c.width / 2, 0, Math.PI * 2);
        ctx.arc(c.x + c.width / 3, c.y - c.width / 4, c.width / 2.5, 0, Math.PI * 2);
        ctx.arc(c.x - c.width / 3, c.y - c.width / 5, c.width / 3, 0, Math.PI * 2);
        ctx.fill();
        if (c.x + c.width < -50) clouds.splice(i, 1);
      }

      // Parallax Trees
      if (frameCount % 60 === 0) {
        trees.push({ x: canvas.width + 50, y: canvas.height - 40, height: 40 + Math.random() * 60, width: 20 + Math.random() * 20, speed: (stats.speed + 1) * 0.4 });
      }
      for (let i = trees.length - 1; i >= 0; i--) {
        const t = trees[i];
        t.x -= t.speed;
        ctx.fillStyle = '#6fac89';
        ctx.beginPath();
        ctx.fillRect(t.x + t.width / 2 - 4, t.y - t.height / 3, 8, t.height / 3);
        ctx.moveTo(t.x, t.y - t.height / 3);
        ctx.lineTo(t.x + t.width / 2, t.y - t.height);
        ctx.lineTo(t.x + t.width, t.y - t.height / 3);
        ctx.fill();
        if (t.x + t.width < -50) trees.splice(i, 1);
      }

      // Ground
      ctx.fillStyle = '#8B4513';
      ctx.fillRect(0, canvas.height - 40, canvas.width, 40);

      // Mask ground for holes and update holes
      ctx.fillStyle = '#87CEEB';
      let overHole = false;
      for (let i = holes.length - 1; i >= 0; i--) {
        const h = holes[i];
        h.x -= h.speed;

        ctx.fillRect(h.x, canvas.height - 40, h.width, 40); // Sky color masks ground to look like a gap

        // Check if player is falling into the hole
        if (player.x + player.width / 2 > h.x && player.x + player.width / 2 < h.x + h.width) {
          overHole = true;
        }

        if (h.x + h.width < 0) holes.splice(i, 1);
      }

      // Player physics
      player.dy += player.gravity;
      player.y += player.dy;

      // Safe landing ONLY if player's feet were previously above the ground line.
      if (!overHole) {
        if (player.y + player.height >= canvas.height - 40 && player.y + player.height - player.dy <= canvas.height - 40) {
          player.y = canvas.height - 40 - player.height;
          player.dy = 0;
          player.isGrounded = true;
        } else if (player.y + player.height > canvas.height - 15) {
          // You slammed into the side wall of the pit because you didn't clear the gap!
          endGame();
          return true;
        }
      } else {
        if (player.y > canvas.height) {
          // You fell off the bottom of the screen into the pit
          endGame();
          return true;
        }
      }

      // Draw Player
      if (!isFlickering || frameCount % 10 < 5) {
        if (dinoImg.complete && dinoImg.naturalHeight > 0) {
          const aspectRatio = dinoImg.naturalWidth / dinoImg.naturalHeight;
          const drawWidth = player.height * aspectRatio;
          const drawX = player.x + (player.width - drawWidth) / 2;

          ctx.save();
          // Pivot around center of the sprite for clean rotation
          ctx.translate(drawX + drawWidth / 2, player.y + player.height / 2);

          if (player.isGrounded) {
            // Running: bounce down slightly + gentle side lean in sync with step cadence
            const phase = frameCount * 0.3;
            ctx.translate(0, Math.abs(Math.sin(phase)) * 3);
            ctx.rotate(Math.sin(phase) * 0.08);
          } else {
            // In air: lean forward going up, ease back on the way down
            ctx.rotate(player.dy < 0 ? -0.22 : 0.06);
            // Slight vertical stretch mid-air
            ctx.scale(0.93, 1.07);
          }

          ctx.drawImage(dinoImg, -drawWidth / 2, -player.height / 2, drawWidth, player.height);
          ctx.restore();
        } else {
          ctx.fillStyle = 'green';
          ctx.fillRect(player.x, player.y, player.width, player.height);
        }
      }

      // Spawn items
      if (frameCount % 85 === 0) spawnObstacle();
      if (frameCount % 60 === 0) spawnCoin();
      if (frameCount % 130 === 65) spawnHole();

      // Obstacles
      for (let i = obstacles.length - 1; i >= 0; i--) {
        const obs = obstacles[i];
        obs.x -= obs.speed;

        // Draw obstacle (Bush)
        ctx.fillStyle = obs.bushColor || '#3CB371';
        ctx.beginPath();
        if (obs.leaves) {
          obs.leaves.forEach((leaf: any) => {
            ctx.arc(obs.x + leaf.ox, obs.y + leaf.oy + 10, leaf.r, 0, Math.PI * 2);
          });
        } else {
          ctx.arc(obs.x + 10, obs.y + obs.height - 15, 15, 0, Math.PI * 2);
        }
        ctx.fill();

        // Add shadow/base underneath to ground it
        ctx.fillStyle = '#1e3f20'; // Dark ground shadow
        ctx.beginPath();
        ctx.ellipse(obs.x + obs.width / 2, obs.y + obs.height - 2, obs.width / 1.5, 6, 0, 0, Math.PI * 2);
        ctx.fill();

        // Collision
        if (
          player.x + 10 < obs.x + obs.width &&
          player.x + player.width - 10 > obs.x &&
          player.y + 10 < obs.y + obs.height &&
          player.y + player.height - 10 > obs.y
        ) {
          if (!isFlickering) {
            bumpSound.current?.play().catch(() => { });
            player.health -= 1;
            isFlickering = true;
            flickerTimer = 1; // 1 second of invincibility/flicker
            if (player.health <= 0) {
              endGame();
              return true;
            }
          }
        }

        if (obs.x + obs.width < 0) obstacles.splice(i, 1);
      }

      // Coins
      for (let i = collectables.length - 1; i >= 0; i--) {
        const coin = collectables[i];
        coin.x -= coin.speed;

        // Draw Treat
        const isHerbivore = dinoDiet?.toLowerCase().includes('herbivore');
        ctx.save();
        ctx.translate(coin.x + coin.width / 2, coin.y + coin.height / 2);

        if (isHerbivore) {
          // Draw Apple
          ctx.fillStyle = '#ff0800';
          ctx.beginPath();
          ctx.arc(0, 2, coin.width / 2 - 2, 0, Math.PI * 2);
          ctx.fill();
          // Stem
          ctx.strokeStyle = '#654321';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(0, -coin.height / 2 + 3);
          ctx.lineTo(2, -coin.height / 2 - 2);
          ctx.stroke();
          // Leaf
          ctx.fillStyle = '#228b22';
          ctx.beginPath();
          ctx.ellipse(3, -coin.height / 2 + 1, 3, 1.5, Math.PI / 4, 0, Math.PI * 2);
          ctx.fill();
        } else {
          // Draw Meat on a bone
          // Bone
          ctx.fillStyle = '#f8f8ff';
          ctx.beginPath();
          ctx.roundRect(-coin.width / 2, -2, coin.width, 4, 2);
          ctx.fill();
          ctx.beginPath();
          ctx.arc(-coin.width / 2, -3, 2, 0, Math.PI * 2);
          ctx.arc(-coin.width / 2, 3, 2, 0, Math.PI * 2);
          ctx.arc(coin.width / 2, -3, 2, 0, Math.PI * 2);
          ctx.arc(coin.width / 2, 3, 2, 0, Math.PI * 2);
          ctx.fill();
          // Meat
          ctx.fillStyle = '#bd3314';
          ctx.beginPath();
          ctx.ellipse(0, 0, coin.width / 2 - 4, coin.height / 2 - 2, 0, 0, Math.PI * 2);
          ctx.fill();
          // Meat detail
          ctx.fillStyle = '#e25822';
          ctx.beginPath();
          ctx.ellipse(2, -2, 2, 1, Math.PI / 4, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();

        // Collision
        if (
          player.x < coin.x + coin.width &&
          player.x + player.width > coin.x &&
          player.y < coin.y + coin.height &&
          player.y + player.height > coin.y
        ) {
          gameCoins++;
          gameScore += 50;
          setCoins(gameCoins);
          setScore(Math.floor(gameScore));
          coinSound.current?.play().catch(() => { });
          collectables.splice(i, 1);
        }

        if (coin.x + coin.width < 0) collectables.splice(i, 1);
      }

      gameScore += 0.5;
      if (frameCount % 30 === 0) {
        setScore(Math.floor(gameScore));
      }

      frameCount++;
      return false;
    };

    const endGame = (won: boolean = false) => {
      setIsGameOver(true);
      cancelAnimationFrame(animationFrameId);
      onGameEnd(Math.floor(gameScore), gameCoins, won, stats.speed);
    };

    animationFrameId = requestAnimationFrame(gameLoop);

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('keydown', handleKeyDown);
      canvas.removeEventListener('touchstart', handleTouch);
      canvas.removeEventListener('mousedown', handleTouch);
    };
  }, [gameStarted, isGameOver, dinoImage, stats, onGameEnd]);

  return (
    <div className="relative w-full max-w-[400px] aspect-[2/3] mx-auto bg-black rounded-3xl overflow-hidden shadow-2xl border-8 border-yellow-400">
      {/* HUD */}
      <div className="absolute top-4 left-4 right-4 flex justify-between items-start z-10">
        <div className="flex flex-col gap-1">
          <div className="bg-blue-600 px-3 py-1 rounded-xl shadow-lg border-2 border-blue-400 text-white font-black text-sm">SCORE: {score}</div>
          <div className="bg-yellow-500 px-3 py-1 rounded-xl shadow-lg border-2 border-yellow-300 text-white font-black text-sm">TREATS: {coins}</div>
        </div>

        <div className="flex flex-col items-end gap-2">
          <div className="bg-red-600 text-white font-black text-lg px-4 py-2 rounded-2xl shadow-lg border-2 border-red-400">
            {timeLeft}s
          </div>
          <button
            onClick={() => setIsMuted(!isMuted)}
            className="bg-black/40 p-2 rounded-full text-white hover:bg-black/60 transition-colors"
          >
            {isMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
          </button>
        </div>
      </div>

      <canvas
        ref={canvasRef}
        width={400}
        height={600}
        className="w-full h-full block bg-[#87CEEB]"
      />

      {/* Start Overlay */}
      <AnimatePresence>
        {!gameStarted && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm flex flex-center items-center justify-center z-20"
          >
            <div className="text-center">
              <h3 className="text-white text-4xl font-black mb-8 tracking-tighter uppercase">Ready to Race?</h3>
              <button
                onClick={() => setGameStarted(true)}
                className="bg-green-500 hover:bg-green-600 text-white px-12 py-6 rounded-3xl font-black text-3xl shadow-2xl hover:scale-110 transition-all flex items-center gap-4 mx-auto"
              >
                <Play size={40} fill="white" /> START!
              </button>
              <p className="text-white/70 mt-6 font-bold uppercase tracking-widest text-sm">Use Space or Tap to Jump</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Controls Hint */}
      {gameStarted && !isGameOver && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 text-white/40 text-sm font-black uppercase tracking-widest animate-pulse pointer-events-none">
          Space or Tap to Jump
        </div>
      )}
    </div>
  );
};
