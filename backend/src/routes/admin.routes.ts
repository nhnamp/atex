import { Router, type Router as ExpressRouter } from 'express';
import multer from 'multer';
import {
  getAllUsers,
  updateUser,
  deleteUser,
  bulkDeleteUsers,
  getTeachers,
  createTeacher,
  createStudent,
  createStudentsFromExcel,
  getDepartments,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  getStudentClasses,
  createStudentClass,
  updateStudentClass,
  deleteStudentClass,
} from '../controllers/admin.controller';
import { addStudents, removeStudent } from '../controllers/class.controller';
import { authenticate, requireRole } from '../middleware/auth';

const router: ExpressRouter = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.use(authenticate, requireRole('ADMIN'));

// Users
router.get('/users', getAllUsers);
router.put('/users/:userId', updateUser);
router.delete('/users/:userId', deleteUser);
router.post('/users/bulk-delete', bulkDeleteUsers);

// Teachers
router.get('/teachers', getTeachers);
router.post('/teachers', createTeacher);

// Students
router.post('/students', createStudent);
router.post('/students/import', upload.single('file'), createStudentsFromExcel);

// Course student management (transferred from teacher)
router.post('/courses/:id/students', addStudents);
router.delete('/courses/:id/students/:studentId', removeStudent);

// Departments
router.get('/departments', getDepartments);
router.post('/departments', createDepartment);
router.put('/departments/:id', updateDepartment);
router.delete('/departments/:id', deleteDepartment);

// Student Classes
router.get('/student-classes', getStudentClasses);
router.post('/student-classes', createStudentClass);
router.put('/student-classes/:id', updateStudentClass);
router.delete('/student-classes/:id', deleteStudentClass);

export default router;
