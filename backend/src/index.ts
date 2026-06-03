import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';

import authRoutes from './routes/auth.routes';
import adminRoutes from './routes/admin.routes';
import classRoutes from './routes/class.routes';
import attendanceRoutes from './routes/attendance.routes';
import subjectRoutes from './routes/subject.routes';
import questionRoutes from './routes/question.routes';
import examRoutes from './routes/exam.routes';
import faceRoutes from './routes/face.routes';
import { prisma } from './lib/prisma';

dotenv.config();

const app = express();
const httpServer = createServer(app);

const io = new SocketServer(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static('uploads'));

// Make io available in controllers
app.set('io', io);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/classes', classRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/subjects', subjectRoutes);
app.use('/api/questions', questionRoutes);
app.use('/api/exams', examRoutes);
app.use('/api/face', faceRoutes);

// Socket.io connection handler
io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  socket.on('join:session', (sessionId: string) => {
    socket.join(`session:${sessionId}`);
    console.log(`Socket ${socket.id} joined session:${sessionId}`);
  });

  socket.on('leave:session', (sessionId: string) => {
    socket.leave(`session:${sessionId}`);
    console.log(`Socket ${socket.id} left session:${sessionId}`);
  });

  // Class-level rooms for instant student notifications
  socket.on('join:class', (classId: string) => {
    socket.join(`class:${classId}`);
  });

  socket.on('leave:class', (classId: string) => {
    socket.leave(`class:${classId}`);
  });

  socket.on('disconnect', () => {
    console.log(`Socket disconnected: ${socket.id}`);
  });
});

// Global error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 5000;

const normalizeLegacyQuestionDifficulty = async (): Promise<void> => {
  await prisma.$executeRawUnsafe(`
    UPDATE "Question"
    SET "difficulty" = CASE
      WHEN UPPER(TRIM(CAST("difficulty" AS TEXT))) IN ('1', 'EASY') THEN 'EASY'
      WHEN UPPER(TRIM(CAST("difficulty" AS TEXT))) IN ('2', '3', 'MEDIUM') THEN 'MEDIUM'
      WHEN UPPER(TRIM(CAST("difficulty" AS TEXT))) IN ('4', '5', 'HARD') THEN 'HARD'
      ELSE 'MEDIUM'
    END
    WHERE "difficulty" IS NULL
      OR UPPER(TRIM(CAST("difficulty" AS TEXT))) NOT IN ('EASY', 'MEDIUM', 'HARD')
      OR UPPER(TRIM(CAST("difficulty" AS TEXT))) IN ('1', '2', '3', '4', '5');
  `);
};

const bootstrap = async () => {
  try {
    await normalizeLegacyQuestionDifficulty();
    httpServer.listen(PORT, () => {
      console.log(`\n🚀 Server running on http://localhost:${PORT}`);
      console.log(`📡 Socket.IO enabled`);
      console.log(`🗄️  Database: PostgreSQL (Prisma)\n`);
    });
  } catch (error) {
    console.error('Failed during server bootstrap:', error);
    process.exit(1);
  }
};

void bootstrap();

export { io };
