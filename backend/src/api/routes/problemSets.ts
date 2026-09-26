import { Router } from 'express';
import * as repo from '../../db/repositories.js';
import { asyncHandler } from '../http.js';

export const problemSetsRouter = Router();

problemSetsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const problemSets = await repo.listProblemSets();
    res.json({ count: problemSets.length, problemSets });
  }),
);
