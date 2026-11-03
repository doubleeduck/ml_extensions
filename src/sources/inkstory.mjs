import createInuko from '../engines/inuko.mjs';
import * as parser from './inkstory_parser.mjs';

export default function createInkStory(ctx){return createInuko(ctx,parser);}
