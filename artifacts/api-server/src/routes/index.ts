import { Router, type IRouter } from "express";
import healthRouter from "./health";
import parseRouter from "./parse";

const router: IRouter = Router();

router.use(healthRouter);
router.use(parseRouter);

export default router;
