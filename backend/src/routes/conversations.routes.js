import { Router } from 'express';
import * as conversationsController from '../controllers/conversations.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import { uploader, verifyFileContents, ACCEPTS } from '../lib/uploadGuard.js';

const router = Router({ mergeParams: true });

router.use(authenticate, workspaceContext);

router.get('/', conversationsController.list);
router.get('/:id/messages', conversationsController.getMessages);
router.get('/:id/context', conversationsController.context);
router.post('/:id/suggest', conversationsController.suggest);
router.get('/:id/notes', conversationsController.listNotes);
router.post('/:id/notes', conversationsController.addNote);
router.delete('/:id/notes/:noteId', conversationsController.deleteNote);
router.patch('/:id/assign', conversationsController.assign);
router.patch('/:id/status', conversationsController.setStatus);
router.post('/:id/messages', conversationsController.sendMessage);
// Attachments. Same guards as a text reply (opt-out, the 24-hour window, a
// message credit), plus the upload validation every other file route uses.
router.post('/:id/media',
  uploader(ACCEPTS.outboundMedia, 100 * 1024 * 1024).single('file'),
  verifyFileContents,
  conversationsController.sendMedia);

export default router;
