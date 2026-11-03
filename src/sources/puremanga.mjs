import createInuko from '../engines/inuko.mjs';
import * as parser from './puremanga_parser.mjs';

export default function createPureManga(ctx){return createInuko(ctx,parser);}
