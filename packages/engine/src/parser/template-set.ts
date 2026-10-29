/**
 * The committed template set of the default compiler (W3b, W3 gap 1): every file under parser/templates/, imported statically so the engine stays I/O-free.
 *
 * Order: the files in PATH order, the order the coverage tools read them in (packages/cards/src/coverage/templates.ts#loadTemplates); a test of the
 * cards package (test/coverage/template-set.test.ts) fails when a file is added, removed or reordered without this module. The order matters: the chart
 * breaks ties by load order (design 6.3) and the G10 retry of parser/parse.ts leaves out the LATEST-loaded template first.
 *
 * Add a new template file here (and nowhere else): `cards/compile.ts#defaultCompileSources` (what a decklist card gets) and `defaultParseOptions` parse with
 * `TEMPLATE_SET`; `BOOTSTRAP_TEMPLATES` stays the WP17 seed set for tests that pin it.
 */
import type { Template } from './types';
import ability from './templates/ability.json';
import bootstrap from './templates/bootstrap.json';
import condition from './templates/condition.json';
import cost from './templates/cost.json';
import duration from './templates/duration.json';
import attach from './templates/effect/attach.json';
import cards from './templates/effect/cards.json';
import choice from './templates/effect/choice.json';
import continuous from './templates/effect/continuous.json';
import copy from './templates/effect/copy.json';
import costmod from './templates/effect/costmod.json';
import counters from './templates/effect/counters.json';
import damage from './templates/effect/damage.json';
import delayed from './templates/effect/delayed.json';
import destroy from './templates/effect/destroy.json';
import flow from './templates/effect/flow.json';
import life from './templates/effect/life.json';
import mana from './templates/effect/mana.json';
import move from './templates/effect/move.json';
import reflexive from './templates/effect/reflexive.json';
import replace from './templates/effect/replace.json';
import restrict from './templates/effect/restrict.json';
import rider from './templates/effect/rider.json';
import search from './templates/effect/search.json';
import shield from './templates/effect/shield.json';
import tokens from './templates/effect/tokens.json';
import keyword from './templates/keyword.json';
import staticTemplates from './templates/static.json';
import trigger from './templates/trigger.json';
import cloudC1 from './templates/zz-cloud/c1.json';
import cloudC10 from './templates/zz-cloud/c10.json';
import cloudC2 from './templates/zz-cloud/c2.json';
import cloudC3 from './templates/zz-cloud/c3.json';
import cloudC4 from './templates/zz-cloud/c4.json';
import cloudC5 from './templates/zz-cloud/c5.json';
import cloudC6 from './templates/zz-cloud/c6.json';
import cloudC7 from './templates/zz-cloud/c7.json';
import cloudC8 from './templates/zz-cloud/c8.json';
import cloudC9 from './templates/zz-cloud/c9.json';
import cloudCmd1 from './templates/zz-cloud/cmd1.json';
import cloudCmd2 from './templates/zz-cloud/cmd2.json';
import cloudCmd3 from './templates/zz-cloud/cmd3.json';
import cloudCmd5 from './templates/zz-cloud/cmd5.json';
import cloudLook3 from './templates/zz-cloud/look3.json';
import cloudP2AttackBlock1 from './templates/zz-cloud/p2-attack-block-1.json';
import cloudP2AttackBlock2 from './templates/zz-cloud/p2-attack-block-2.json';
import cloudP2CDieroll1 from './templates/zz-cloud/p2-c-dieroll-1.json';
import cloudP2Coinflip1 from './templates/zz-cloud/p2-coinflip-1.json';
import cloudP2Coinflip2 from './templates/zz-cloud/p2-coinflip-2.json';
import cloudP2Coinflip3 from './templates/zz-cloud/p2-coinflip-3.json';
import cloudP2CombatFlow1 from './templates/zz-cloud/p2-combat-flow-1.json';
import cloudP2CombatFlow2 from './templates/zz-cloud/p2-combat-flow-2.json';
import cloudPcPlayers1 from './templates/zz-cloud/pc-players-1.json';
import cloudR3Choose from './templates/zz-cloud/r3-choose.json';
import cloudR3Copy from './templates/zz-cloud/r3-copy.json';
import cloudR3Cost from './templates/zz-cloud/r3-cost.json';
import cloudR3Dig from './templates/zz-cloud/r3-dig.json';
import cloudR3Fx from './templates/zz-cloud/r3-fx.json';
import cloudR3Mech from './templates/zz-cloud/r3-mech.json';
import cloudR3Moved from './templates/zz-cloud/r3-moved.json';
import cloudR3Refs from './templates/zz-cloud/r3-refs.json';
import cloudR3Repl from './templates/zz-cloud/r3-repl.json';
import cloudR3Static from './templates/zz-cloud/r3-static.json';
import cloudR3Trig from './templates/zz-cloud/r3-trig.json';
import cloudR4Copy from './templates/zz-cloud/r4-copy.json';
import cloudStdFreecast5 from './templates/zz-cloud/std-freecast-5.json';
import cloudR4Cost from './templates/zz-cloud/r4-cost.json';
import cloudR4Dig from './templates/zz-cloud/r4-dig.json';
import cloudR4Fxb from './templates/zz-cloud/r4-fxb.json';
import cloudR4Fxz from './templates/zz-cloud/r4-fxz.json';
import cloudR4Mech from './templates/zz-cloud/r4-mech.json';
import cloudR4Moved from './templates/zz-cloud/r4-moved.json';
import cloudR4Refs from './templates/zz-cloud/r4-refs.json';
import cloudR4Repl from './templates/zz-cloud/r4-repl.json';
import cloudR4Static from './templates/zz-cloud/r4-static.json';
import cloudR4Trig from './templates/zz-cloud/r4-trig.json';
import cloudR5Cost from './templates/zz-cloud/r5-cost.json';
import cloudR5Dig from './templates/zz-cloud/r5-dig.json';
import cloudR5Fxb from './templates/zz-cloud/r5-fxb.json';
import cloudR5Fxz from './templates/zz-cloud/r5-fxz.json';
import cloudR5Mech from './templates/zz-cloud/r5-mech.json';
import cloudR5Moved from './templates/zz-cloud/r5-moved.json';
import cloudR5Refs from './templates/zz-cloud/r5-refs.json';
import cloudR5Repl from './templates/zz-cloud/r5-repl.json';
import cloudR5Static from './templates/zz-cloud/r5-static.json';
import cloudR5Trig from './templates/zz-cloud/r5-trig.json';
import cloudStdBlb from './templates/zz-cloud/std-blb.json';
import cloudStdCardcopy1 from './templates/zz-cloud/std-cardcopy-1.json';
import cloudStdCardcopy2 from './templates/zz-cloud/std-cardcopy-2.json';
import cloudStdCardcopy3 from './templates/zz-cloud/std-cardcopy-3.json';
import cloudStdCardcopy5 from './templates/zz-cloud/std-cardcopy-5.json';
import cloudStdCardcopy9 from './templates/zz-cloud/std-cardcopy-9.json';
import cloudStdCombat1 from './templates/zz-cloud/std-combat-1.json';
import cloudStdCombat2 from './templates/zz-cloud/std-combat-2.json'; // std-combat-2
import cloudStdCombat5 from './templates/zz-cloud/std-combat-5.json';
import cloudStdControl1 from './templates/zz-cloud/std-control-1.json';
import cloudStdControl3 from './templates/zz-cloud/std-control-3.json';
import cloudStdCopy1 from './templates/zz-cloud/std-copy-1.json';
import cloudStdCopy2 from './templates/zz-cloud/std-copy-2.json';
import cloudStdCopy3 from './templates/zz-cloud/std-copy-3.json';
import cloudStdCopy4 from './templates/zz-cloud/std-copy-4.json';
import cloudStdCopy6 from './templates/zz-cloud/std-copy-6.json';
import cloudStdCosts1 from './templates/zz-cloud/std-costs-1.json';
import cloudStdCosts2 from './templates/zz-cloud/std-costs-2.json';
import cloudStdCraft1 from './templates/zz-cloud/std-craft-1.json';
import cloudStdCraft2 from './templates/zz-cloud/std-craft-2.json';
import cloudStdDft from './templates/zz-cloud/std-dft.json';
import cloudStdDsk from './templates/zz-cloud/std-dsk.json';
import cloudStdEcl from './templates/zz-cloud/std-ecl.json';
import cloudStdEoe from './templates/zz-cloud/std-eoe.json';
import cloudStdExilePlay11 from './templates/zz-cloud/std-exile-play-1-1.json';
import cloudStdExilePlay12 from './templates/zz-cloud/std-exile-play-1-2.json';
import cloudStdExilePlay21 from './templates/zz-cloud/std-exile-play-2-1.json';
import cloudStdExilePlay22 from './templates/zz-cloud/std-exile-play-2-2.json';
import cloudStdExilePlay23 from './templates/zz-cloud/std-exile-play-2-3.json';
import cloudStdExilePlay24 from './templates/zz-cloud/std-exile-play-2-4.json';
import cloudStdFdn from './templates/zz-cloud/std-fdn.json';
import cloudStdFin from './templates/zz-cloud/std-fin.json';
import cloudStdFra from './templates/zz-cloud/std-fra.json';
import cloudStdFreecast1 from './templates/zz-cloud/std-freecast-1.json';
import cloudStdFreecast2 from './templates/zz-cloud/std-freecast-2.json';
import cloudStdFreecast3 from './templates/zz-cloud/std-freecast-3.json';
import cloudStdFreecast4 from './templates/zz-cloud/std-freecast-4.json';
import cloudStdHob from './templates/zz-cloud/std-hob.json';
import cloudStdLci from './templates/zz-cloud/std-lci.json';
import cloudStdLibrary1 from './templates/zz-cloud/std-library-1.json';
import cloudStdLibrary2 from './templates/zz-cloud/std-library-2.json';
import cloudStdLibrary3 from './templates/zz-cloud/std-library-3.json';
import cloudStdLibrary4 from './templates/zz-cloud/std-library-4.json';
import cloudStdMana1 from './templates/zz-cloud/std-mana-1.json';
import cloudStdMana12 from './templates/zz-cloud/std-mana-12.json';
import cloudStdMana2 from './templates/zz-cloud/std-mana-2.json';
import cloudStdMisc from './templates/zz-cloud/std-misc.json';
import cloudStdMkm from './templates/zz-cloud/std-mkm.json';
import cloudStdMsh from './templates/zz-cloud/std-msh.json';
import cloudStdOtj from './templates/zz-cloud/std-otj.json';
import cloudStdR10 from './templates/zz-cloud/std-r10.json';
import cloudStdR6 from './templates/zz-cloud/std-r6.json';
import cloudStdR9 from './templates/zz-cloud/std-r9.json';
import cloudStdR9b from './templates/zz-cloud/std-r9b.json';
import cloudStdRD from './templates/zz-cloud/std-rD.json';
import cloudStdRa from './templates/zz-cloud/std-ra.json';
import cloudStdRb from './templates/zz-cloud/std-rb.json';
import cloudStdRc from './templates/zz-cloud/std-rc.json';
import cloudStdRe from './templates/zz-cloud/std-re.json';
import cloudStdRf from './templates/zz-cloud/std-rf.json';
import cloudStdRg from './templates/zz-cloud/std-rg.json';
import cloudStdRh from './templates/zz-cloud/std-rh.json';
import cloudStdRi from './templates/zz-cloud/std-ri.json';
import cloudStdRj from './templates/zz-cloud/std-rj.json';
import cloudStdRl from './templates/zz-cloud/std-rl.json';
import cloudStdRm from './templates/zz-cloud/std-rm.json';
import cloudStdRn from './templates/zz-cloud/std-rn.json';
import cloudStdRo from './templates/zz-cloud/std-ro.json';
import cloudStdRp from './templates/zz-cloud/std-rp.json';
import cloudStdRq from './templates/zz-cloud/std-rq.json';
import cloudStdRr from './templates/zz-cloud/std-rr.json';
import cloudStdRs from './templates/zz-cloud/std-rs.json';
import cloudStdRt from './templates/zz-cloud/std-rt.json';
import cloudStdRu from './templates/zz-cloud/std-ru.json';
import cloudStdRw6 from './templates/zz-cloud/std-rw6.json';
import cloudStdRw7 from './templates/zz-cloud/std-rw7.json';
import cloudStdRw8 from './templates/zz-cloud/std-rw8.json';
import cloudStdRw9 from './templates/zz-cloud/std-rw9.json';
import cloudStdRx1 from './templates/zz-cloud/std-rx1.json';
import cloudStdRx10 from './templates/zz-cloud/std-rx10.json';
import cloudStdRx11 from './templates/zz-cloud/std-rx11.json';
import cloudStdRx12 from './templates/zz-cloud/std-rx12.json';
import cloudStdRx13 from './templates/zz-cloud/std-rx13.json';
import cloudStdRx14 from './templates/zz-cloud/std-rx14.json';
import cloudStdRx15 from './templates/zz-cloud/std-rx15.json';
import cloudStdRx16 from './templates/zz-cloud/std-rx16.json';
import cloudStdRx18 from './templates/zz-cloud/std-rx18.json';
import cloudStdRx19 from './templates/zz-cloud/std-rx19.json';
import cloudStdRx2 from './templates/zz-cloud/std-rx2.json';
import cloudStdRx20 from './templates/zz-cloud/std-rx20.json';
import cloudStdRx21 from './templates/zz-cloud/std-rx21.json';
import cloudStdRx22 from './templates/zz-cloud/std-rx22.json';
import cloudStdRx23 from './templates/zz-cloud/std-rx23.json';
import cloudStdRx24 from './templates/zz-cloud/std-rx24.json';
import cloudStdRx25 from './templates/zz-cloud/std-rx25.json';
import cloudStdRx26 from './templates/zz-cloud/std-rx26.json';
import cloudStdRx27 from './templates/zz-cloud/std-rx27.json';
import cloudStdRx28 from './templates/zz-cloud/std-rx28.json';
import cloudStdRx29 from './templates/zz-cloud/std-rx29.json';
import cloudStdRx3 from './templates/zz-cloud/std-rx3.json';
import cloudStdRx30 from './templates/zz-cloud/std-rx30.json';
import cloudStdRx31 from './templates/zz-cloud/std-rx31.json';
import cloudStdRx32 from './templates/zz-cloud/std-rx32.json';
import cloudStdRx33 from './templates/zz-cloud/std-rx33.json';
import cloudStdRx34 from './templates/zz-cloud/std-rx34.json';
import cloudStdRx35 from './templates/zz-cloud/std-rx35.json';
import cloudStdRx5 from './templates/zz-cloud/std-rx5.json';
import cloudStdRx6 from './templates/zz-cloud/std-rx6.json';
import cloudStdRx7 from './templates/zz-cloud/std-rx7.json';
import cloudStdRx8 from './templates/zz-cloud/std-rx8.json';
import cloudStdRx9 from './templates/zz-cloud/std-rx9.json';
import cloudStdRy10 from './templates/zz-cloud/std-ry10.json';
import cloudStdRy3 from './templates/zz-cloud/std-ry3.json';
import cloudStdRy4 from './templates/zz-cloud/std-ry4.json';
import cloudStdRy5 from './templates/zz-cloud/std-ry5.json';
import cloudStdRy6 from './templates/zz-cloud/std-ry6.json';
import cloudStdRy8 from './templates/zz-cloud/std-ry8.json';
import cloudStdSos from './templates/zz-cloud/std-sos.json';
import cloudStdSpm from './templates/zz-cloud/std-spm.json';
import cloudStdTdm from './templates/zz-cloud/std-tdm.json';
import cloudStdTla from './templates/zz-cloud/std-tla.json';
import cloudStdTmt from './templates/zz-cloud/std-tmt.json';
import cloudStdTypechange1 from './templates/zz-cloud/std-typechange-1.json';
import cloudStdTypechange2 from './templates/zz-cloud/std-typechange-2.json';
import cloudStdWoe from './templates/zz-cloud/std-woe.json';
import cloudTrek4 from './templates/zz-cloud/trek-4.json';
import cloudTrek6 from './templates/zz-cloud/trek-6.json';
import fast1T4 from './templates/zz-fast1/t4.json';
import fast1T5 from './templates/zz-fast1/t5.json';
import fast1T6 from './templates/zz-fast1/t6.json';
import fast2T10 from './templates/zz-fast2/t10.json';
import fast2T7 from './templates/zz-fast2/t7.json';
import fast2T8 from './templates/zz-fast2/t8.json';
import fast2T9 from './templates/zz-fast2/t9.json';
import fast3T11 from './templates/zz-fast3/t11.json';
import fast3T12 from './templates/zz-fast3/t12.json';
import fast3T13 from './templates/zz-fast3/t13.json';
import fast3T14 from './templates/zz-fast3/t14.json';
import fast3T15 from './templates/zz-fast3/t15.json';
import fast3T16 from './templates/zz-fast3/t16.json';
import fast3T17 from './templates/zz-fast3/t17.json';
import fast3T18 from './templates/zz-fast3/t18.json';
import fast4Mx2 from './templates/zz-fast4/mx2.json';
import fast4T19 from './templates/zz-fast4/t19.json';
import fast4T20 from './templates/zz-fast4/t20.json';
import fast4T21 from './templates/zz-fast4/t21.json';
import fast4T22 from './templates/zz-fast4/t22.json';
import fast4T23 from './templates/zz-fast4/t23.json';
import fast4T24 from './templates/zz-fast4/t24.json';
import fast4T25 from './templates/zz-fast4/t25.json';
import fast4T26 from './templates/zz-fast4/t26.json';
import fast4T27 from './templates/zz-fast4/t27.json';
import fast4T28 from './templates/zz-fast4/t28.json';
import fast4T29 from './templates/zz-fast4/t29.json';
import fast4T30 from './templates/zz-fast4/t30.json';
import fast4T31 from './templates/zz-fast4/t31.json';
import fast4T32 from './templates/zz-fast4/t32.json';
import fast4T33 from './templates/zz-fast4/t33.json';
import fast4T34 from './templates/zz-fast4/t34.json';
import fast5Mx3 from './templates/zz-fast5/mx3.json';
import fast5Mx4 from './templates/zz-fast5/mx4.json';
import fast5Mx5 from './templates/zz-fast5/mx5.json';
import fast5Mx6 from './templates/zz-fast5/mx6.json';
import fast5Mx7 from './templates/zz-fast5/mx7.json';
import fast5T35 from './templates/zz-fast5/t35.json';
import fast5T36 from './templates/zz-fast5/t36.json';
import fast5T37 from './templates/zz-fast5/t37.json';
import fast5T38 from './templates/zz-fast5/t38.json';
import fast5T39 from './templates/zz-fast5/t39.json';
import fast5T40 from './templates/zz-fast5/t40.json';
import fast5T41 from './templates/zz-fast5/t41.json';
import fast5T42 from './templates/zz-fast5/t42.json';
import fast5T43 from './templates/zz-fast5/t43.json';
import fast5T44 from './templates/zz-fast5/t44.json';
import fast5T45 from './templates/zz-fast5/t45.json';
import fast5T46 from './templates/zz-fast5/t46.json';
import fast5T47 from './templates/zz-fast5/t47.json';
import fast5T48 from './templates/zz-fast5/t48.json';
import fast5T49 from './templates/zz-fast5/t49.json';
import fast5T50 from './templates/zz-fast5/t50.json';
import fast5T51 from './templates/zz-fast5/t51.json';
import fast5T52 from './templates/zz-fast5/t52.json';
import fast5T53 from './templates/zz-fast5/t53.json';
import fast5T54 from './templates/zz-fast5/t54.json';
import fast5T55 from './templates/zz-fast5/t55.json';
import fast5T56 from './templates/zz-fast5/t56.json';
import fast5T57 from './templates/zz-fast5/t57.json';
import fast5T58 from './templates/zz-fast5/t58.json';
import fast5T59 from './templates/zz-fast5/t59.json';
import fast5T60 from './templates/zz-fast5/t60.json';
import fast5T61 from './templates/zz-fast5/t61.json';
import fast5T62 from './templates/zz-fast5/t62.json';
import fast5T63 from './templates/zz-fast5/t63.json';
import fast5T64 from './templates/zz-fast5/t64.json';
import fast5T65 from './templates/zz-fast5/t65.json';
import fast5T66 from './templates/zz-fast5/t66.json';
import fast5T67 from './templates/zz-fast5/t67.json';
import fast5T68 from './templates/zz-fast5/t68.json';
import fast5T69 from './templates/zz-fast5/t69.json';
import fast5T70 from './templates/zz-fast5/t70.json';
import fast5T71 from './templates/zz-fast5/t71.json';
import fast5T72 from './templates/zz-fast5/t72.json';
import fast5T74 from './templates/zz-fast5/t74.json';
import fast5T75 from './templates/zz-fast5/t75.json';
import fast5T76 from './templates/zz-fast5/t76.json';
import fast5T77 from './templates/zz-fast5/t77.json';
import fast5T78 from './templates/zz-fast5/t78.json';
import fast5xE1 from './templates/zz-fast5x/e1.json';
import fast5xE10 from './templates/zz-fast5x/e10.json';
import fast5xE11 from './templates/zz-fast5x/e11.json';
import fast5xE12 from './templates/zz-fast5x/e12.json';
import fast5xE13 from './templates/zz-fast5x/e13.json';
import fast5xE14 from './templates/zz-fast5x/e14.json';
import fast5xE15 from './templates/zz-fast5x/e15.json';
import fast5xE16 from './templates/zz-fast5x/e16.json';
import fast5xE17 from './templates/zz-fast5x/e17.json';
import fast5xE18 from './templates/zz-fast5x/e18.json';
import fast5xE19 from './templates/zz-fast5x/e19.json';
import fast5xE2 from './templates/zz-fast5x/e2.json';
import fast5xE20 from './templates/zz-fast5x/e20.json';
import fast5xE21 from './templates/zz-fast5x/e21.json';
import fast5xE22 from './templates/zz-fast5x/e22.json';
import fast5xE23 from './templates/zz-fast5x/e23.json';
import fast5xE24 from './templates/zz-fast5x/e24.json';
import fast5xE25 from './templates/zz-fast5x/e25.json';
import fast5xE26 from './templates/zz-fast5x/e26.json';
import fast5xE27 from './templates/zz-fast5x/e27.json';
import fast5xE28 from './templates/zz-fast5x/e28.json';
import fast5xE29 from './templates/zz-fast5x/e29.json';
import fast5xE3 from './templates/zz-fast5x/e3.json';
import fast5xE3xp from './templates/zz-fast5x/e3xp.json';
import fast5xE4 from './templates/zz-fast5x/e4.json';
import fast5xE6 from './templates/zz-fast5x/e6.json';
import fast5xE7 from './templates/zz-fast5x/e7.json';
import fast5xE8 from './templates/zz-fast5x/e8.json';
import fast5xE9 from './templates/zz-fast5x/e9.json';
import fast5xGy1 from './templates/zz-fast5x/gy1.json';
import m11Cmdf from './templates/zz-m11/cmdf.json';
import m11Commander from './templates/zz-m11/commander.json';
import m12Goad from './templates/zz-m12/goad.json';
import m12Players from './templates/zz-m12/players.json';
import m12Vote from './templates/zz-m12/vote.json';
import zzM6Copy from './templates/zz-m6/copy.json';
import m6Costs from './templates/zz-m6/costs.json';
import m6Dfc from './templates/zz-m6/dfc.json';
import m6Face from './templates/zz-m6/face.json';
import m6Gate from './templates/zz-m6/gate.json';
import m6Layouts from './templates/zz-m6/layouts.json';
import m6Merge from './templates/zz-m6/merge.json';
import m6Replace from './templates/zz-m6/replace.json';
import m6Requirements from './templates/zz-m6/requirements.json';
import m6Text from './templates/zz-m6/text.json';
import m6Triggers from './templates/zz-m6/triggers.json';
import zzPushK1 from './templates/zz-push/k1.json';
import pushT1 from './templates/zz-push/t1.json';
import pushT2 from './templates/zz-push/t2.json';
import pushT3 from './templates/zz-push/t3.json';
import cloudP2CopyPerm1 from './templates/zz-cloud/p2-copy-perm-1.json';
import cloudP2CopySpell1 from './templates/zz-cloud/p2-copy-spell-1.json';
import cloudP2CopySpell3 from './templates/zz-cloud/p2-copy-spell-3.json';
import cloudP2CostParts1 from './templates/zz-cloud/p2-cost-parts-1.json';
import cloudP2CostStatics1 from './templates/zz-cloud/p2-cost-statics-1.json';
import cloudP2CostStatics2 from './templates/zz-cloud/p2-cost-statics-2.json';
import cloudP2CountersMove1 from './templates/zz-cloud/p2-counters-move-1.json';
import cloudP2CountersMove3 from './templates/zz-cloud/p2-counters-move-3.json';
import cloudP2CountersMove4 from './templates/zz-cloud/p2-counters-move-4.json';
import cloudP2CountersState1 from './templates/zz-cloud/p2-counters-state-1.json';
import cloudP2CountersState2 from './templates/zz-cloud/p2-counters-state-2.json';
import cloudP2Damage1 from './templates/zz-cloud/p2-damage-1.json';
import cloudP2Damage2 from './templates/zz-cloud/p2-damage-2.json';
import cloudP2Damage3 from './templates/zz-cloud/p2-damage-3.json';
import cloudP2Dig1 from './templates/zz-cloud/p2-dig-1.json';
import cloudP2ExilePlay1 from './templates/zz-cloud/p2-exile-play-1.json';
import cloudP2Graveyard1 from './templates/zz-cloud/p2-graveyard-1.json';
import cloudP2Graveyard2 from './templates/zz-cloud/p2-graveyard-2.json';
import cloudP2GroupActions1 from './templates/zz-cloud/p2-group-actions-1.json';
import cloudP2GroupActions2 from './templates/zz-cloud/p2-group-actions-2.json';
import cloudP2Mana1 from './templates/zz-cloud/p2-mana-1.json';
import cloudP2Mana2 from './templates/zz-cloud/p2-mana-2.json';
import cloudP2Misc1 from './templates/zz-cloud/p2-misc-1.json';
import cloudP2Misc2 from './templates/zz-cloud/p2-misc-2.json';
import cloudP2Modal1 from './templates/zz-cloud/p2-modal-1.json';
import cloudP2PlayerRules1 from './templates/zz-cloud/p2-player-rules-1.json';
import cloudP2PlayerRules2 from './templates/zz-cloud/p2-player-rules-2.json';
import cloudP2PlayerRules3 from './templates/zz-cloud/p2-player-rules-3.json';
import cloudP2Pt1 from './templates/zz-cloud/p2-pt-1.json';
import cloudP2Pt2 from './templates/zz-cloud/p2-pt-2.json';
import cloudP2Pt3 from './templates/zz-cloud/p2-pt-3.json';
import cloudP2Refs1 from './templates/zz-cloud/p2-refs-1.json';
import cloudP2Refs2 from './templates/zz-cloud/p2-refs-2.json';
import cloudP2Refs3 from './templates/zz-cloud/p2-refs-3.json';
import cloudP2ReplaceDamage1 from './templates/zz-cloud/p2-replace-damage-1.json';
import cloudP2ReplaceDamage2 from './templates/zz-cloud/p2-replace-damage-2.json';
import cloudP2ReplaceDamage3 from './templates/zz-cloud/p2-replace-damage-3.json';
import cloudP2ReplaceDamage4 from './templates/zz-cloud/p2-replace-damage-4.json';
import cloudP2ReplaceEvents1 from './templates/zz-cloud/p2-replace-events-1.json';
import cloudP2ReplaceEvents2 from './templates/zz-cloud/p2-replace-events-2.json';
import cloudP2ReplaceEvents3 from './templates/zz-cloud/p2-replace-events-3.json';
import cloudP2Typechange1 from './templates/zz-cloud/p2-typechange-1.json';
import cloudP2Typechange2 from './templates/zz-cloud/p2-typechange-2.json';
import cloudP2Typechange3 from './templates/zz-cloud/p2-typechange-3.json';
import cloudP2Typechange4 from './templates/zz-cloud/p2-typechange-4.json';
import cloudPcStatics2 from './templates/zz-cloud/pc-statics-2.json';
import cloudP2ZoneMoves1 from './templates/zz-cloud/p2-zone-moves-1.json';
import cloudPcCombat1 from './templates/zz-cloud/pc-combat-1.json';
import cloudPcCombat2 from './templates/zz-cloud/pc-combat-2.json';
import cloudPcCombat4 from './templates/zz-cloud/pc-combat-4.json';
import cloudPcCounters1 from './templates/zz-cloud/pc-counters-1.json';
import cloudPcCounters2 from './templates/zz-cloud/pc-counters-2.json';
import cloudPcCounters3 from './templates/zz-cloud/pc-counters-3.json';
import cloudPcExilePlay1 from './templates/zz-cloud/pc-exile-play-1.json';
import cloudPcExilePlay2 from './templates/zz-cloud/pc-exile-play-2.json';
import cloudPcExilePlay3 from './templates/zz-cloud/pc-exile-play-3.json';
import cloudPcExilePlay4 from './templates/zz-cloud/pc-exile-play-4.json';
import cloudPcKeywordsMana1 from './templates/zz-cloud/pc-keywords-mana-1.json';
import cloudPcKeywordsMana2 from './templates/zz-cloud/pc-keywords-mana-2.json';
import cloudPcKeywordsMana3 from './templates/zz-cloud/pc-keywords-mana-3.json';
import cloudPcPlayers2 from './templates/zz-cloud/pc-players-2.json';
import cloudPcPlayers3 from './templates/zz-cloud/pc-players-3.json';
import cloudPcStatics1 from './templates/zz-cloud/pc-statics-1.json';
import cloudPcTokens1 from './templates/zz-cloud/pc-tokens-1.json';
import cloudPcTokens2 from './templates/zz-cloud/pc-tokens-2.json';
import cloudPcZones1 from './templates/zz-cloud/pc-zones-1.json';
import cloudPcZones2 from './templates/zz-cloud/pc-zones-2.json';
import cloudPcZones3 from './templates/zz-cloud/pc-zones-3.json';
import cloudStdCardcopy13 from './templates/zz-cloud/std-cardcopy-13.json';
import cloudStdCardcopy7 from './templates/zz-cloud/std-cardcopy-7.json';
import cloudStdExilePlay13 from './templates/zz-cloud/std-exile-play-1-3.json';
import cloudTrek1 from './templates/zz-cloud/trek-1.json';
import cloudTrek11 from './templates/zz-cloud/trek-11.json';
import cloudTrek12 from './templates/zz-cloud/trek-12.json';
import cloudTrek2 from './templates/zz-cloud/trek-2.json';
import cloudTrek3 from './templates/zz-cloud/trek-3.json';
import cloudTrek5 from './templates/zz-cloud/trek-5.json';
import cloudTrek7 from './templates/zz-cloud/trek-7.json';
import cloudTrek8 from './templates/zz-cloud/trek-8.json';
import cloudTrek9 from './templates/zz-cloud/trek-9.json';
import cloudEdhCast1 from './templates/zz-cloud/edh-cast-1.json';
import cloudEdhMk1 from './templates/zz-cloud/edh-mana-keywords-1.json';
import cloudEdhPm1 from './templates/zz-cloud/edh-perms-1.json';
import cloudEdhPlayers1 from './templates/zz-cloud/edh-players-1.json';
import cloudEdhZones1 from './templates/zz-cloud/edh-zones-1.json';
import cloudP2ZoneMoves2 from './templates/zz-cloud/p2-zone-moves-2.json';

/** The template files in path order (relative to parser/templates), with their templates. */
export const TEMPLATE_FILES: readonly { file: string; templates: readonly Template[] }[] = Object.freeze(([
  ['ability.json', ability],
  ['bootstrap.json', bootstrap],
  ['condition.json', condition],
  ['cost.json', cost],
  ['duration.json', duration],
  ['effect/attach.json', attach],
  ['effect/cards.json', cards],
  ['effect/choice.json', choice],
  ['effect/continuous.json', continuous],
  ['effect/copy.json', copy],
  ['effect/costmod.json', costmod],
  ['effect/counters.json', counters],
  ['effect/damage.json', damage],
  ['effect/delayed.json', delayed],
  ['effect/destroy.json', destroy],
  ['effect/flow.json', flow],
  ['effect/life.json', life],
  ['effect/mana.json', mana],
  ['effect/move.json', move],
  ['effect/reflexive.json', reflexive],
  ['effect/replace.json', replace],
  ['effect/restrict.json', restrict],
  ['effect/rider.json', rider],
  ['effect/search.json', search],
  ['effect/shield.json', shield],
  ['effect/tokens.json', tokens],
  ['keyword.json', keyword],
  ['static.json', staticTemplates],
  ['trigger.json', trigger],
  // Cloud batch 2 (docs/CARD_WORK.md): the Standard backlog slices, one file per slice under zz-cloud/ (path order: 'zz-cloud' sorts after 'trigger.json', before 'zz-fast1')
  // Cloud batch 1 families (CLOUD C1..C5) share zz-cloud/ too, in the same path order (c1, c2, ... sort before look3)
  ['zz-cloud/c1.json', cloudC1], // C1 (cloud batch 1): "target spell can't be countered" and "<spells> can't be countered this turn" as resolved restrictions (CR 101.2, 701.6a, 611.2c)
  ['zz-cloud/c10.json', cloudC10], // C10 (cloud batch 3; path order: 'c10' sorts before 'std-'): casting from the graveyard as a static permission and its riders (CR 601.3, 601.2f, 614.1c)
  ['zz-cloud/c2.json', cloudC2], // C2: maximum hand size N (yours, a player's), no maximum hand size (a player, players, for the rest of the game)
  ['zz-cloud/c3.json', cloudC3], // C3: tap-and-freeze ('tap that creature and it doesn't untap during its controller's next untap step', the plural 'they don't untap'), lords with a trailing 'as long as' or 'during your turn' (CR 701.26a, 502.3, 611.3a, 613.1f)
  ['zz-cloud/c4.json', cloudC4], // C4: edict and mass-destroy riders: 'if X is N or more, destroy all other <filter>' after a destroy, 'if X is N or more, <effects>'
  ['zz-cloud/c5.json', cloudC5], // C5: named choices and their references: "Choose a color.", "the chosen color / type" read from the face's "As ~ enters, choose ..." (CR 607.2d)
  ['zz-cloud/c6.json', cloudC6], // C6: per-player instructions and their results: "for each opponent who can't, <effects>" (CR 101.3, 608.2c, 608.2e-f)
  ['zz-cloud/c7.json', cloudC7], // Cloud C7 (cloud batch 3): counts of what an earlier instruction moved ('you draw a card for each', 'gain / lose N life for each'), 'discard any number of cards', 'sacrifice any number of <permanents>'
  ['zz-cloud/c8.json', cloudC8], // C8 (cloud batch 3): references to what a cost moved ("the discarded card", "the exiled card"): becomes an X/X artifact creature, where X is ...
  ['zz-cloud/c9.json', cloudC9], // CLOUD C9 (cloud batch 3): "instead" that replaces several instructions or another one: search for any card, reveal that card and put it into your hand, a search for cards of two descriptions
  ['zz-cloud/cmd1.json', cloudCmd1], // cmd1: the Commander backlog slice cmd1 (partner variants and Backgrounds): self pumps where X is a quantity, ...
  ['zz-cloud/cmd2.json', cloudCmd2], // cmd2 (commander batch): references to commanders in card text (CR 903.3d, 903.3e, 903.8, 113.6): cast triggers of the spell itself, commander casts
  ['zz-cloud/cmd3.json', cloudCmd3], // CMD3 (commander batch): the Commander-product backlog, white, blue and colorless identities: Thriving lands (a color other than, {W} or one mana of the chosen color), ...
  ['zz-cloud/cmd5.json', cloudCmd5], // cmd5: the Commander backlog with two or more colors (tuning half): sacrifice another permanent, ...
  ['zz-cloud/edh-cast-1.json', cloudEdhCast1], // edh-cast-1 (Commander lane edh-cast; path order: 'edh-cast' sorts after 'cmd5', before 'edh-mana'): casting from the top of the library for life, cost reductions by color, subtype and power
  ['zz-cloud/edh-mana-keywords-1.json', cloudEdhMk1], // edh-mana-keywords-1 (Commander lane edh-mana-keywords; path order: 'edh-' sorts after 'cmd5', before 'look3'): any color among, Equip legendary creature, the exiled card's colors, see the file
  ['zz-cloud/edh-perms-1.json', cloudEdhPm1], // edh-perms-1 (Commander lane edh-perms; path order: 'edh-p' sorts after 'edh-m', before 'look3'): see the file
  ['zz-cloud/edh-players-1.json', cloudEdhPlayers1], // edh-players-1 (Commander lane edh-players; path order: 'edh-' sorts after 'cmd', before 'look3'): "you may play two additional lands on each of your turns", "may draw up to N cards"
  ['zz-cloud/edh-zones-1.json', cloudEdhZones1], // edh-zones-1 (Commander effort, lane edh-zones; path order: 'edh' sorts after 'cmd5', before 'look3'): library and graveyard moves, see the file
  ['zz-cloud/look3.json', cloudLook3], // LOOK3: "If you don't put the card onto the battlefield / into your hand, ..." after the card was looked at (CR 608.2c, 701.20e)
  ['zz-cloud/p2-attack-block-1.json', cloudP2AttackBlock1], // p2-attack-block-1 (lane p2-attack-block; path order: 'p2-' sorts after 'look3', before 'r3-'): attack and block restrictions (CR 506.5, 508.1c, 509.1b, 702.14)
  ['zz-cloud/p2-attack-block-2.json', cloudP2AttackBlock2], // p2-attack-block-2 (lane p2-attack-block; path order: 'p2-' sorts after 'look3', before 'r3-'): attack and block restrictions II (CR 509.1b, 609.4, 702.3b)
  ['zz-cloud/p2-c-dieroll-1.json', cloudP2CDieroll1], // p2-c-dieroll-1 (Phase 2 lane p2-c-dieroll; path order: 'p2-c-' sorts after 'look3', before 'p2-copy'): die rolls and result tables (CR 706)
  ['zz-cloud/p2-coinflip-1.json', cloudP2Coinflip1], // p2-coinflip-1 (Phase 2 lane p2-coinflip; path order: 'p2-coinflip' sorts before 'p2-copy-perm'): random choices: return at random from your graveyard, reveal at random from a hand, damage to an object chosen at random (CR 608.2d)
  ['zz-cloud/p2-coinflip-2.json', cloudP2Coinflip2], // p2-coinflip-2 (Phase 2 lane p2-coinflip; path order: after 'p2-coinflip-1', before 'p2-copy-perm'): random discards after a draw, a reveal at random then a life loss (CR 701.9b, 701.20a)
  ['zz-cloud/p2-coinflip-3.json', cloudP2Coinflip3], // p2-coinflip-3 (Phase 2 lane p2-coinflip; path order: after 'p2-coinflip-2', before 'p2-copy-perm'): a random return to the battlefield, tokens for each flip you win (CR 608.2d, 705.2)
  ['zz-cloud/p2-combat-flow-1.json', cloudP2CombatFlow1], // p2-combat-flow-1 (Phase 2 lane p2-combat-flow; path order: 'p2-' sorts after 'look3', before 'r3-'): combat flow, see the file's templates
  ['zz-cloud/p2-combat-flow-2.json', cloudP2CombatFlow2], // p2-combat-flow-2 (Phase 2 lane p2-combat-flow; path order: 'p2-combat' sorts after 'look3', before 'p2-copy'): "becomes blocked" as an effect, tokens that are attacking
  ['zz-cloud/p2-copy-perm-1.json', cloudP2CopyPerm1], // p2-copy-perm-1 (lane p2-copy-perm; path order: 'p2-' sorts after 'look3', before 'r3-'): copy exceptions as one list hole, CopyExcept (CR 707.9b)
  ['zz-cloud/p2-copy-spell-1.json', cloudP2CopySpell1], // p2-copy-spell-1 (lane p2-copy-spell; path order: 'p2-copy-spell' sorts after 'p2-copy-perm', before 'p2-counters'): another player's optional copy of this spell, the Chain spells (CR 707.10c, 608.2d)
  ['zz-cloud/p2-copy-spell-3.json', cloudP2CopySpell3], // p2-copy-spell-3 (lane p2-copy-spell; path order: after 'p2-copy-spell-1', before 'p2-counters'): a copy of a spell another player makes and the new targets they may choose (CR 707.10c)
  ['zz-cloud/p2-cost-parts-1.json', cloudP2CostParts1], // p2-cost-parts-1 (lane p2-cost-parts; path order: 'p2-' sorts after 'look3', before 'r3-'): a choice of three additional costs (CR 601.2b, 118.8)
  ['zz-cloud/p2-cost-statics-1.json', cloudP2CostStatics1], // p2-cost-statics-1 (Phase 2 lane p2-cost-statics; path order: 'p2-cos' sorts after 'p2-cop', before 'p2-cou'): cost statics, reductions and increases by quantities and conditions, alternative costs with conditions (CR 601.2f, 118.7, 118.9)
  ['zz-cloud/p2-cost-statics-2.json', cloudP2CostStatics2], // p2-cost-statics-2 (Phase 2 lane p2-cost-statics; path order: 'p2-cos' sorts after 'p2-cop', before 'p2-cou'; p2-cost-statics-1 sorts before it): cost changes by what a spell or an ability targets (CR 601.2c, 601.2f, 115.9b)
  ['zz-cloud/p2-counters-move-1.json', cloudP2CountersMove1], // p2-counters-move-1 (Phase 2 lane p2-counters-move; path order: 'p2-counters-m' sorts before 'p2-counters-s'): moving counters of any kind, all counters, any number of counters (CR 122.5)
  ['zz-cloud/p2-counters-move-3.json', cloudP2CountersMove3], // p2-counters-move-3 (Phase 2 lane p2-counters-move; path order: 'p2-counters-m' sorts before 'p2-counters-s'): the count before a pump, 'For each <qty>, <obj> gets <pt> <dur>' (CR 613.4c)
  ['zz-cloud/p2-counters-move-4.json', cloudP2CountersMove4], // p2-counters-move-4 (Phase 2 lane p2-counters-move; path order after p2-counters-move-1 (and -3), before p2-counters-state-1): any number of counters moved onto a group, divided (CR 122.5)
  ['zz-cloud/p2-counters-state-1.json', cloudP2CountersState1], // p2-counters-state-1 (lane p2-counters-state; path order: 'p2-' sorts after 'look3', before 'r3-'): counters as state, exile with counters, pumps per counter on it (CR 122.1)
  ['zz-cloud/p2-counters-state-2.json', cloudP2CountersState2], // p2-counters-state-2 (lane p2-counters-state; path order: 'p2-' sorts after 'look3', before 'r3-'): counted quantities, see the file
  ['zz-cloud/p2-damage-1.json', cloudP2Damage1], // p2-damage-1 (Phase 2 lane p2-damage; path order: 'p2-damage-1' sorts after 'look3', before 'r3-choose'): damage effects, see the file's templates
  ['zz-cloud/p2-damage-2.json', cloudP2Damage2], // p2-damage-2 (Phase 2 lane p2-damage; path order: 'p2-damage-2' sorts after 'p2-counters-state-1', before 'p2-player-rules-1'): damage effects, see the file's templates
  ['zz-cloud/p2-damage-3.json', cloudP2Damage3], // p2-damage-3 (Phase 2 lane p2-damage; path order: 'p2-damage-3' sorts after 'p2-damage-2'): damage effects, see the file's templates
  ['zz-cloud/p2-dig-1.json', cloudP2Dig1], // p2-dig-1 (Phase 2 lane p2-dig; path order: 'p2-' sorts after 'look3', before 'r3-'): "play with the top card of your library revealed" (permit revealTop, CR 401.2) and the lane's digs
  ['zz-cloud/p2-exile-play-1.json', cloudP2ExilePlay1], // p2-exile-play-1 (Phase 2 lane p2-exile-play; path order: 'p2-' sorts after 'look3', before 'r3-'): play and cast from exile, cards exiled with ~ (CR 607.2a)
  ['zz-cloud/p2-graveyard-1.json', cloudP2Graveyard1], // p2-graveyard-1 (Phase 2 lane p2-graveyard; path order: 'p2-graveyard-1' sorts after 'look3', before 'r3-choose'): cast from the graveyard and graveyard riders, see the file
  ['zz-cloud/p2-graveyard-2.json', cloudP2Graveyard2], // p2-graveyard-2 (Phase 2 lane p2-graveyard; path order: 'p2-graveyard-2' sorts after 'p2-counters-state', before 'p2-player-rules'): "can't enter the battlefield" from graveyards and libraries, "can't cast spells from graveyards or libraries / exile" (CR 614.17d, 601.3)
  ['zz-cloud/p2-group-actions-1.json', cloudP2GroupActions1], // p2-group-actions-1 (lane p2-group-actions; path order: 'p2-group' sorts after 'p2-counters', before 'p2-player'): each player keeps what they choose, the rest go (CR 608.2d)
  ['zz-cloud/p2-group-actions-2.json', cloudP2GroupActions2], // p2-group-actions-2 (lane p2-group-actions; path order: 'p2-group' sorts after 'p2-counters', before 'p2-player'): each opponent may scry / put a card from their hand onto the battlefield (CR 608.2d)
  ['zz-cloud/p2-mana-1.json', cloudP2Mana1], // p2-mana-1 (Phase 2 lane p2-mana; path order: 'p2-mana-1' sorts after 'look3', before 'r3-'): mana abilities, see the file
  ['zz-cloud/p2-mana-2.json', cloudP2Mana2], // p2-mana-2 (Phase 2 lane p2-mana; path order: after 'p2-counters-state-1', before 'p2-player-rules-1'): devotion mana, see the file
  ['zz-cloud/p2-misc-1.json', cloudP2Misc1], // p2-misc-1 (Phase 2 lane p2-misc; path order: 'p2-' sorts after 'look3', before 'r3-'): day/night (CR 731), keyword actions and small mechanics
  ['zz-cloud/p2-misc-2.json', cloudP2Misc2], // p2-misc-2 (Phase 2 lane p2-misc; path order: 'p2-misc' sorts after 'p2-counters', before 'p2-player'): trigger doublers of spells, a player's protection from everything
  ['zz-cloud/p2-modal-1.json', cloudP2Modal1], // p2-modal-1 (Phase 2 lane p2-modal; path order: 'p2-modal' sorts after 'p2-counters', before 'p2-player'): "choose any number of <creatures> with different powers" (CR 208.1, 608.2d)
  ['zz-cloud/p2-player-rules-1.json', cloudP2PlayerRules1], // p2-player-rules-1 (Phase 2 lane p2-player-rules; path order: 'p2-' sorts after 'look3', before 'r3-'): player rules and riders: "lose K and can't have or gain K", detain, untap limits, draw limits
  ['zz-cloud/p2-player-rules-2.json', cloudP2PlayerRules2], // p2-player-rules-2 (Phase 2 lane p2-player-rules; path order: 'p2-' sorts after 'look3', before 'r3-'): clash with an opponent / defending player, "If you win, ... Otherwise, ..." (CR 701.30)
  ['zz-cloud/p2-player-rules-3.json', cloudP2PlayerRules3], // p2-player-rules-3 (Phase 2 lane p2-player-rules; path order: after 'p2-player-rules-2'): "As long as C, your opponents can't cast spells during your turn" (CR 611.3a)
  ['zz-cloud/p2-pt-1.json', cloudP2Pt1], // p2-pt-1 (Phase 2 lane p2-pt; path order: 'p2-' sorts after 'look3', before 'r3-'): power/toughness pumps and exchanges, see the file
  ['zz-cloud/p2-pt-2.json', cloudP2Pt2], // p2-pt-2 (Phase 2 lane p2-pt; path order: 'p2-pt' sorts after 'p2-player', before 'p2-replace'): group pumps with grants and per-object counts, see the file
  ['zz-cloud/p2-pt-3.json', cloudP2Pt3], // p2-pt-3 (Phase 2 lane p2-pt; path order: 'p2-pt' sorts after 'p2-player', before 'p2-replace'): group and attached pumps (counts, colors, conditions), see the file
  ['zz-cloud/p2-refs-1.json', cloudP2Refs1], // p2-refs-1 (Phase 2 lane p2-refs; path order: 'p2-refs-1' sorts after 'look3', before 'r3-choose'): plural "the exiled cards" links (CR 607.2a)
  ['zz-cloud/p2-refs-2.json', cloudP2Refs2], // p2-refs-2 (Phase 2 lane p2-refs; path order: 'p2-refs-2' sorts after 'look3', before 'r3-choose'): "<noun> destroyed this way can't be regenerated" (CR 701.19c)
  ['zz-cloud/p2-refs-3.json', cloudP2Refs3], // p2-refs-3 (Phase 2 lane p2-refs; path order: 'p2-refs-3' sorts after 'p2-refs-2', before 'p2-replace-damage-1'): "spells with the chosen name can't be cast" (CR 601.3, 607.2d)
  ['zz-cloud/p2-replace-damage-1.json', cloudP2ReplaceDamage1], // p2-replace-damage-1 (Phase 2 lane p2-replace-damage; path order: 'p2-' sorts after 'look3', before 'r3-'): damage prevention and replacement statics and shields (CR 615, 614.1a)
  ['zz-cloud/p2-replace-damage-2.json', cloudP2ReplaceDamage2], // p2-replace-damage-2 (Phase 2 lane p2-replace-damage; path order: 'p2-' sorts after 'look3', before 'r3-'): damage-increase replacements (CR 614.1a, 120.3)
  ['zz-cloud/p2-replace-damage-3.json', cloudP2ReplaceDamage3], // p2-replace-damage-3 (Phase 2 lane p2-replace-damage; path order: 'p2-' sorts after 'look3', before 'r3-'): damage redirection (CR 614.9)
  ['zz-cloud/p2-replace-damage-4.json', cloudP2ReplaceDamage4], // p2-replace-damage-4 (Phase 2 lane p2-replace-damage): prevention leftovers: during your turn, to a group by sources, the next time an object or a described source of your choice (CR 615)
  ['zz-cloud/p2-replace-events-1.json', cloudP2ReplaceEvents1], // p2-replace-events-1 (Phase 2 lane p2-replace-events; path order: 'p2-' sorts after 'look3', before 'r3-'): event replacements (CR 614.1a): counters, tokens, life, mill, draws
  ['zz-cloud/p2-replace-events-2.json', cloudP2ReplaceEvents2], // p2-replace-events-2 (Phase 2 lane p2-replace-events; path order: 'p2-' sorts after 'look3', before 'r3-'): event replacements (CR 614.1a): leave the battlefield, exile instead
  ['zz-cloud/p2-replace-events-3.json', cloudP2ReplaceEvents3], // p2-replace-events-3 (Phase 2 lane p2-replace-events; path order: 'p2-replace-events-3' sorts after 'p2-replace-events-1', before 'r3-'): event replacements (CR 614.1a): extra turns, draws, scry
  ['zz-cloud/p2-typechange-1.json', cloudP2Typechange1], // p2-typechange-1 (Phase 2 lane p2-typechange; path order: 'p2-' sorts after 'look3', before 'r3-'): type changes, see the file
  ['zz-cloud/p2-typechange-2.json', cloudP2Typechange2], // p2-typechange-2 (lane p2-typechange): colors and types added, becomes a <color> artifact, ~ becomes an enchantment
  ['zz-cloud/p2-typechange-3.json', cloudP2Typechange3], // p2-typechange-3 (Phase 2 lane p2-typechange; path order: 'p2-' sorts after 'p2-replace-', before 'r3-'): see the file
  ['zz-cloud/p2-typechange-4.json', cloudP2Typechange4], // p2-typechange-4 (lane p2-typechange): all creature types with a pump, see the file
  ['zz-cloud/p2-zone-moves-1.json', cloudP2ZoneMoves1], // p2-zone-moves-1 (Phase 2 lane p2-zone-moves; path order: 'p2-zone-moves-1' sorts after 'look3', before 'r3-choose'): wheels, "then draws that many cards minus N", "the greatest number of cards a player discarded this way" (CR 701.9a, 121.1)
  ['zz-cloud/p2-zone-moves-2.json', cloudP2ZoneMoves2], // p2-zone-moves-2 (Phase 2 lane p2-zone-moves; path order: 'p2-zone-moves-2' sorts after the other 'p2-' files, before 'r3-choose'): "put that card into your hand and the rest into your graveyard" after a reveal until (CR 701.20a, 608.2c)
  ['zz-cloud/pc-combat-1.json', cloudPcCombat1], // pc-combat-1 (Commander precon lane pc-combat; path order: 'pc-combat-1' sorts after 'p2-zone-moves-1', before 'r1'): combat triggers and riders, see the file's templates
  ['zz-cloud/pc-combat-2.json', cloudPcCombat2], // pc-combat-2 (precon lane pc-combat; path order: 'pc-combat-2' sorts before 'pc-exile-play-1'): put a card from hand onto the battlefield tapped and attacking
  ['zz-cloud/pc-combat-4.json', cloudPcCombat4], // pc-combat-4 (precon lane pc-combat; path order: 'pc-combat-4' sorts before 'pc-exile-play-1'): draw cards and gain control of this permanent, untap it
  ['zz-cloud/pc-counters-1.json', cloudPcCounters1], // pc-counters-1 (precon lane pc-counters; path order: 'pc-' sorts after 'p2-', before 'r3-'): counters and energy, see the file
  ['zz-cloud/pc-counters-2.json', cloudPcCounters2], // pc-counters-2 (precon lane pc-counters; path order: 'pc-' sorts after 'p2-', before 'r3-'): pumps counting counters, see the file
  ['zz-cloud/pc-counters-3.json', cloudPcCounters3], // pc-counters-3 (precon lane pc-counters; path order: 'pc-counters-3' after 'pc-counters-2'): energy per object, see the file
  ['zz-cloud/pc-exile-play-1.json', cloudPcExilePlay1], // pc-exile-play-1 (precon lane pc-exile-play; path order: 'pc-' sorts after 'p2-', before 'r3-'): casting and playing from exile, copies of spells
  ['zz-cloud/pc-exile-play-2.json', cloudPcExilePlay2], // pc-exile-play-2 (precon lane pc-exile-play; path order: after 'p2-', before 'r3-'): the first spell cast each turn
  ['zz-cloud/pc-exile-play-3.json', cloudPcExilePlay3], // pc-exile-play-3 (precon lane pc-exile-play; path order: after 'pc-exile-play-2', before 'r3-'): the next spell has cascade or storm
  ['zz-cloud/pc-exile-play-4.json', cloudPcExilePlay4], // pc-exile-play-4 (precon lane pc-exile-play; path order: after 'pc-exile-play-1', before 'r3-'): cast spells from among a group this turn, pay life
  ['zz-cloud/pc-keywords-mana-1.json', cloudPcKeywordsMana1], // pc-keywords-mana-1 (precon lane keywords-mana; path order: 'pc-' sorts after 'p2-', before 'r3-'): "Choose a color. Add one mana of that color for each <kind> counter on <object>"
  ['zz-cloud/pc-keywords-mana-2.json', cloudPcKeywordsMana2], // pc-keywords-mana-2 (precon lane keywords-mana; path order: 'pc-' sorts after 'p2-', before 'r3-'): mana riders and mana abilities, see the file
  ['zz-cloud/pc-keywords-mana-3.json', cloudPcKeywordsMana3], // pc-keywords-mana-3 (precon lane keywords-mana; path order: 'pc-' sorts after 'p2-', before 'r3-'): "faces a villainous choice"
  ['zz-cloud/pc-players-1.json', cloudPcPlayers1], // pc-players-1 (precon lane pc-players; path order: 'pc-' sorts after 'p2-zone-moves-1', before 'r3-'): imp gain life equal, draw N cards for each, loses life equal unless
  ['zz-cloud/pc-players-2.json', cloudPcPlayers2], // pc-players-2 (precon lane pc-players; path order after pc-players-1): draw N cards if <condition>
  ['zz-cloud/pc-players-3.json', cloudPcPlayers3], // pc-players-3 (precon lane pc-players; path order after pc-players-2): damage unless they control
  ['zz-cloud/pc-statics-1.json', cloudPcStatics1], // pc-statics-1 (precon lane pc-statics; path order: 'pc-' sorts after 'p2-zone-moves-1', before 'r3-choose'): see the file
  ['zz-cloud/pc-statics-2.json', cloudPcStatics2], // pc-statics-2 (precon lane pc-statics; path order: 'pc-' sorts after 'p2-zone-moves-1', before 'r3-choose'): see the file
  ['zz-cloud/pc-tokens-1.json', cloudPcTokens1], // pc-tokens-1 (lane pc-tokens, precon decks; path order: 'pc-tokens-1' sorts after 'p2-zone-moves-1', before 'r3-choose'): token and copy readings
  ['zz-cloud/pc-tokens-2.json', cloudPcTokens2], // pc-tokens-2 (lane pc-tokens, precon decks; path order: 'pc-tokens-2' sorts after 'pc-players-1', before 'r3-choose'): copies, replacements
  ['zz-cloud/pc-zones-1.json', cloudPcZones1], // pc-zones-1 (precon lane pc-zones; appended at the end of the zz-cloud block): library placement, reveal until and put all revealed, digs
  ['zz-cloud/pc-zones-2.json', cloudPcZones2], // pc-zones-2 (precon lane pc-zones; path order: 'pc-' sorts after 'p2-zone-moves-1', before 'r3-'): searches that share a land type, each player searches and puts onto the battlefield, manifest by another player, a color and a type added to a returned creature
  ['zz-cloud/pc-zones-3.json', cloudPcZones3], // pc-zones-3 (precon lane pc-zones; path order: 'pc-zones' sorts after 'pc-players', before 'r3-'): conditional permissions to play lands and cast spells from the top of the library
  ['zz-cloud/r3-choose.json', cloudR3Choose], // r3-choose (Standard round 3; path order: 'r3-' sorts after 'look3', before 'std-'): targets, choices and modes, on Cloud std-eoe's "choose <targets>" (CR 601.2b-c, 700.2)
  ['zz-cloud/r3-copy.json', cloudR3Copy], // r3-copy (Standard round 3, path order: 'r3-' sorts after 'look3', before 'std-'): copies and control: token copies made by another player, "becomes a copy" with a leading duration or an exception, "become copies" (CR 707, 706, 108.4)
  ['zz-cloud/r3-cost.json', cloudR3Cost], // r3-cost (Standard round 3, path order: 'r3-cost' sorts after 'look3', before 'std-'): costs and mana (CR 601.2f, 118, 605, 106)
  ['zz-cloud/r3-dig.json', cloudR3Dig], // r3-dig (Standard round 3): library digs and impulse play: reveal until, the rest, at random (CR 701.20, 401, 608.2c); path order: 'r3-dig' sorts after 'look3'
  ['zz-cloud/r3-fx.json', cloudR3Fx], // Standard round 3, r3-fx: conditions, turn history and one-shot effects no other slice reads (path order: 'r3-fx' sorts after 'look3', before 'std-')
  ['zz-cloud/r3-mech.json', cloudR3Mech], // Standard round 3 r3-mech (path order: 'r3-mech' sorts after 'look3', before 'std-'): set mechanics and words the lexicon lacks: coin flips, ...
  ['zz-cloud/r3-moved.json', cloudR3Moved], // Standard round 3, r3-moved: what an earlier instruction or a cost moved, beyond C7 and C8 (CR 608.2c, 608.2h; path order: 'r3-moved' sorts after 'r3-mech', before 'std-')
  ['zz-cloud/r3-refs.json', cloudR3Refs], // Standard round 3, r3-refs: references and durations, antecedents a template does not read (path order: 'r3-refs' sorts after 'r3-mech', before 'r3-repl'; CR 608.2c, 611.2)
  ['zz-cloud/r3-repl.json', cloudR3Repl], // Cloud r3-repl (Standard round 3, path order: 'r3-' sorts after 'look3', before 'std-'): replacement and prevention effects (CR 614, 615, 616)
  ['zz-cloud/r3-static.json', cloudR3Static], // r3-static (Standard round 3): static and continuous effects: "can't" rules, permissions, rule changes, granted abilities (CR 604, 609.4, 611.3a, 613)
  ['zz-cloud/r3-trig.json', cloudR3Trig], // Standard round 3, r3-trig: trigger conditions no template read (CR 603), intervening "if" clauses (CR 603.4), triggers of the card itself off the battlefield (CR 113.6k); path order: 'r3-trig' sorts after 'r3-fx', before 'std-'
  ['zz-cloud/r4-copy.json', cloudR4Copy], // r4-copy (Standard round 4, path order: 'r4-' sorts after 'r3-', before 'std-'): copies and control, held-out and leftover units: enters as a copy, becomes a copy, copy a card and cast the copy, gain control (CR 707, 706, 108.4)
  ['zz-cloud/r4-cost.json', cloudR4Cost], // r4-cost (Standard round 4; path order: 'r4-' sorts after 'r3-fx', before 'std-'): costs, mana and choices (CR 601.2b-f, 602.5, 106, 118, 605)
  ['zz-cloud/r4-dig.json', cloudR4Dig], // r4-dig (Standard round 4, path order: 'r4-dig' sorts after 'r3-static', before 'std-'): library digs and impulse play, held-out and leftover units (CR 401, 701.20, 601.3, 608.2c)
  ['zz-cloud/r4-fxb.json', cloudR4Fxb], // Standard round 4, r4-fxb: one-shot effects on the board and the turn (counters, damage, P/T, abilities lost, tokens, tap/untap, extra steps, life; path order: 'r4-fxb' sorts after 'r3-fx', before 'std-')
  ['zz-cloud/r4-fxz.json', cloudR4Fxz], // Standard round 4, r4-fxz: one-shot effects on cards, zones and players no other slice reads (path order: 'r4-fxz' sorts after 'r3-fx', before 'std-')
  ['zz-cloud/r4-mech.json', cloudR4Mech], // Standard round 4 r4-mech (path order: 'r4-mech' sorts after 'r3-', before 'std-'): set mechanics and words the lexicon lacks, both halves
  ['zz-cloud/r4-moved.json', cloudR4Moved], // Standard round 4, r4-moved: "this way" results of an earlier instruction, held-out units of r3-moved's family (CR 608.2c, 608.2h, 603.12; path order: 'r4-moved' sorts after 'r3-moved', before 'std-')
  ['zz-cloud/r4-refs.json', cloudR4Refs], // Standard round 4, r4-refs: references and durations, both halves of Standard (path order: 'r4-refs' sorts after 'r3-refs', before 'std-'; CR 608.2c, 611.2)
  ['zz-cloud/r4-repl.json', cloudR4Repl], // Cloud r4-repl (Standard round 4, path order: 'r4-' sorts after 'r3-', before 'std-'): replacement and prevention effects (CR 614, 615, 616)
  ['zz-cloud/r4-static.json', cloudR4Static], // r4-static (Standard round 4, both halves): static and continuous effects: compound statics, "as long as" conditions, granted abilities, combat restrictions (CR 604, 611, 613)
  ['zz-cloud/r4-trig.json', cloudR4Trig], // Standard round 4, r4-trig: trigger conditions (CR 603) and intervening "if" clauses (CR 603.4) of the round-4 backlog, both halves (path order: 'r4-trig' sorts after 'r3-trig', before 'std-')
  ['zz-cloud/r5-cost.json', cloudR5Cost], // r5-cost (Standard round 5; path order: 'r5-' sorts after 'r4-cost', before 'std-'): costs, mana and choices, the engine mechanisms r4-cost left (CR 601.2b-f, 602.5, 106, 118, 605, 700.2)
  ['zz-cloud/r5-dig.json', cloudR5Dig], // r5-dig (Standard round 5, path order: 'r5-dig' sorts after 'r4-dig', before 'std-'): the library digs and impulse play round 4 left: piles, "the revealed cards", opponents' choices among cards (CR 401, 608.2c-d, 701.20)
  ['zz-cloud/r5-fxb.json', cloudR5Fxb], // Standard round 5, r5-fxb: r4-fxb's family continued (one-shot effects on the board and the turn) and the engine mechanisms its skipped units needed (path order: 'r5-fxb' sorts after 'r4-fxb', before 'std-')
  ['zz-cloud/r5-fxz.json', cloudR5Fxz], // Standard round 5, r5-fxz: one-shot effects on cards, zones and players, continuing r4-fxz (path order: 'r5-fxz' sorts after 'r4-fxz', before 'std-')
  ['zz-cloud/r5-mech.json', cloudR5Mech], // Standard round 5 r5-mech (path order: 'r5-mech' sorts after 'r4-', before 'std-'): set mechanics, words the lexicon lacks and copy leftovers, both halves
  ['zz-cloud/r5-moved.json', cloudR5Moved], // Standard round 5, r5-moved: "this way" results round 4 left (CR 608.2c, 608.2h, 607.2a; path order: 'r5-moved' sorts after 'r4-moved', before 'std-')
  ['zz-cloud/r5-refs.json', cloudR5Refs], // Standard round 5, r5-refs: references and durations, the mechanisms r4-refs skipped (path order: 'r5-refs' sorts after 'r4-refs', before 'std-'; CR 608.2c, 611.2, 603.7, 607.2a)
  ['zz-cloud/r5-repl.json', cloudR5Repl], // Cloud r5-repl (Standard round 5, path order: 'r5-' sorts after 'r4-', before 'std-'): replacement and prevention effects (CR 614, 615, 616)
  ['zz-cloud/r5-static.json', cloudR5Static], // r5-static (Standard round 5): static and continuous effects: the costs to attack and block (CR 508.1h-j, 509.1d-f), ...
  ['zz-cloud/r5-trig.json', cloudR5Trig], // Standard round 5, r5-trig: trigger conditions (CR 603) and intervening "if" clauses (CR 603.4) the round-4 slice skipped (path order: 'r5-trig' sorts after 'r4-trig', before 'std-')
  ['zz-cloud/std-blb.json', cloudStdBlb], // std-blb: the Standard backlog of Bloomburrow (blb), path order ('std-blb' sorts before 'std-hob'): see the file's templates
  ['zz-cloud/std-cardcopy-1.json', cloudStdCardcopy1], // std-cardcopy-1 (lane std-cardcopy; path order: 'std-ca' sorts after 'std-blb', before 'std-dft'): copies of cards exiled with a source (CR 607.2a, 707.12), see the file
  ['zz-cloud/std-cardcopy-13.json', cloudStdCardcopy13], // std-cardcopy-13 (lane std-cardcopy; path order: 'std-cardcopy-13' sorts after 'std-cardcopy-1.', before 'std-cardcopy-2'): a described card exiled from your graveyard at random and a tapped token copy (CR 608.2d, 707.2, 110.5b); carried over from std-cardcopy-4
  ['zz-cloud/std-cardcopy-2.json', cloudStdCardcopy2], // std-cardcopy-2: copies of cards exiled with a source, linked across abilities (CR 607.2a, 707.2)
  ['zz-cloud/std-cardcopy-3.json', cloudStdCardcopy3], // std-cardcopy-3 (lane std-cardcopy; path order: 'std-ca' sorts after 'std-blb', before 'std-dft'): cards exiled as a permanent enters and copies of them (CR 614.12a, 607.2a, 707.9), see the file
  ['zz-cloud/std-cardcopy-5.json', cloudStdCardcopy5], // std-cardcopy-5 (lane std-cardcopy; path order: 'std-cardcopy-5' sorts after 'std-blb', before 'std-dft'): "one or more creatures you control and/or creature cards in your graveyard are put into exile", a choice from among them, a copy until end of turn with an exception (CR 603.2c, 707.9a)
  ['zz-cloud/std-cardcopy-7.json', cloudStdCardcopy7], // std-cardcopy-7 (lane std-cardcopy; path order: after 'std-cardcopy-5', before 'std-combat-1'): copies of cards cast up to N or within a total mana value, a target per card type, a cost totalling mana symbols (CR 707.12, 608.2d, 115.1), see the file
  ['zz-cloud/std-cardcopy-9.json', cloudStdCardcopy9], // std-cardcopy-9 (lane std-cardcopy; path order: after the other 'std-cardcopy-*' files, before 'std-dft'): the last chosen card and its activated and triggered abilities (CR 607.2d, 613.1f)
  ['zz-cloud/std-combat-1.json', cloudStdCombat1], // std-combat-1 (lane std-combat; path order: 'std-combat-1' sorts after 'std-blb', before 'std-dft'): combat and attack triggers, see the file's templates
  ['zz-cloud/std-combat-2.json', cloudStdCombat2], // std-combat-2 (lane std-combat; path order: 'std-combat-2' sorts after 'std-blb', before 'std-dft'): "Do the same for <keywords>" (CR 608.2c, 122.1b)
  ['zz-cloud/std-combat-5.json', cloudStdCombat5], // std-combat-5 (lane std-combat; path order: 'std-combat-5' sorts after 'std-blb' and 'std-combat-1', before 'std-dft'): a secret choice, three tokens, "if <obj> is the chosen type"
  ['zz-cloud/std-control-1.json', cloudStdControl1], // std-control-1 (lane std-control; path order: 'std-control-1' sorts after 'std-blb', before 'std-dft'): speed reduction, see the file's templates
  ['zz-cloud/std-control-3.json', cloudStdControl3], // std-control-3 (lane std-control; path order: 'std-control-3' sorts after 'std-blb', before 'std-dft'): controlling another player (CR 723)
  ['zz-cloud/std-copy-1.json', cloudStdCopy1], // std-copy-1 (lane std-copy; path order: 'std-copy-1' sorts after 'std-blb', before 'std-dft'): spell copies, "can't be copied" (CR 707.10)
  ['zz-cloud/std-copy-2.json', cloudStdCopy2], // std-copy-2 (lane std-copy; path order: 'std-copy-2' sorts after 'std-blb', before 'std-dft'): "each <filter> becomes prepared" (CR 722.3a)
  ['zz-cloud/std-copy-3.json', cloudStdCopy3], // std-copy-3 (lane std-copy; path order: 'std-copy-3' sorts after 'std-copy-1', before 'std-dft'): "When that mana is spent to cast ..." (CR 106.6, 603.2)
  ['zz-cloud/std-copy-4.json', cloudStdCopy4], // std-copy-4 (lane std-copy; path order: 'std-copy-4' sorts after 'std-blb', before 'std-dft'): an intervening "if it's the first <spell>, ... you've cast this turn" as cast patterns (CR 603.4)
  ['zz-cloud/std-copy-6.json', cloudStdCopy6], // std-copy-6 (lane std-copy; path order: 'std-copy-6' sorts after 'std-blb', before 'std-dft'): copy and exile the spell cast with counters, gaining suspend (CR 702.62)
  ['zz-cloud/std-costs-1.json', cloudStdCosts1], // std-costs-1 (lane std-costs; path order: 'std-costs-1' sorts after 'std-blb', before 'std-dft'): "search ... for any number of cards with that name and exile them" (CR 701.23a, 608.2c)
  ['zz-cloud/std-costs-2.json', cloudStdCosts2], // std-costs-2 (lane std-costs; path order: 'std-costs-2' sorts after 'std-blb', before 'std-dft'): "choose a creature you control or a warped creature card you own in exile" as an additional cost (CR 601.2b)
  ['zz-cloud/std-craft-1.json', cloudStdCraft1], // std-craft-1 (lane std-craft; path order: 'std-craft-1' sorts after 'std-blb', before 'std-dft'): "Craft with a X, a Y, a Z, and a W" (CR 702.167a), "you may put an exiled <card> used to craft ~ onto the battlefield ... tapped and attacking" (CR 702.167c)
  ['zz-cloud/std-craft-2.json', cloudStdCraft2], // std-craft-2 (lane std-craft; path order: after 'std-craft-1', before 'std-dft'): "~ has each activated ability of <the craft link>. You may activate each of those abilities only once each turn." (CR 602.5b, 613.1f)
  ['zz-cloud/std-dft.json', cloudStdDft], // std-dft: the Aetherdrift (dft) Standard backlog (tuning half)
  ['zz-cloud/std-dsk.json', cloudStdDsk], // std-dsk: the Standard backlog of Duskmourn (dsk): aura and equipment riders, counter-kind choices, ... (path order: 'std-dsk' before 'std-hob')
  ['zz-cloud/std-ecl.json', cloudStdEcl], // std-ecl: the Standard backlog of set ecl (Lorwyn Eclipsed); path order: 'std-ecl' sorts before 'std-hob'
  ['zz-cloud/std-eoe.json', cloudStdEoe], // std-eoe: the Standard backlog of Edge of Eternities (eoe), tuning half
  ['zz-cloud/std-exile-play-1-1.json', cloudStdExilePlay11], // std-exile-play-1-1 (lane std-exile-play-1; path order: 'std-exile-play-1-1' sorts after 'std-eoe', before 'std-fdn'): play and cast from exile and the top of a library: life costs, "the exiled cards", mana of any type (CR 601.3, 611.2, 118.9, 609.4b)
  ['zz-cloud/std-exile-play-1-2.json', cloudStdExilePlay12], // std-exile-play-1-2 (lane std-exile-play-1; path order: 'std-exile-play-1-2' sorts after 'std-exile-play-1-1' and 'std-eoe', before 'std-fdn'): "choose a card exiled this way" (CR 608.2c), cast and play permissions of exiled cards
  ['zz-cloud/std-exile-play-1-3.json', cloudStdExilePlay13], // std-exile-play-1-3 (lane std-exile-play-1; path order: 'std-exile-play-1-3' sorts after 'std-exile-play-1-2', before 'std-exile-play-2-2'): each opponent exiles a card from their hand and may play it (cost increase, lands enter tapped), players may play the cards they exiled (CR 601.3, 608.2c)
  ['zz-cloud/std-exile-play-2-1.json', cloudStdExilePlay21], // std-exile-play-2-1 (lane std-exile-play-2; path order: 'std-exile' sorts after 'std-eoe'): play from exile paying life, exile until each player's total mana value
  ['zz-cloud/std-exile-play-2-2.json', cloudStdExilePlay22], // std-exile-play-2-2 (lane std-exile-play-2; path order: 'std-exile' sorts after 'std-eoe'): a cast spell exiled with a counter as it resolves; cast from among your exiled cards with counters
  ['zz-cloud/std-exile-play-2-3.json', cloudStdExilePlay23], // std-exile-play-2-3 (lane std-exile-play-2; path order: 'std-exile' sorts after 'std-eoe'): exile up to N cards from a player's graveyard; a named cast permission paid by waterbending
  ['zz-cloud/std-exile-play-2-4.json', cloudStdExilePlay24], // std-exile-play-2-4 (lane std-exile-play-2; path order: 'std-exile' sorts after 'std-eoe'): a permission for the cards of a group a comparison picks; for each of those colors
  ['zz-cloud/std-fdn.json', cloudStdFdn], // std-fdn: the Standard backlog of Foundations (fdn): additional combat phase, first time each turn, the sacrificed object as an antecedent, ...
  ['zz-cloud/std-fin.json', cloudStdFin], // std-fin: the Final Fantasy (fin) slice of the Standard backlog (path order: 'std-fin' sorts before 'std-hob')
  ['zz-cloud/std-fra.json', cloudStdFra], // std-fra: the Standard backlog of set fra (design 6.12, tuning half)
  ['zz-cloud/std-freecast-1.json', cloudStdFreecast1], // std-freecast-1: free casts: the first spell each player casts during their turns, the next spell this turn (path order: 'std-freecast' sorts after 'std-fra')
  ['zz-cloud/std-freecast-2.json', cloudStdFreecast2], // std-freecast-2: one spell from your graveyard this turn, enters with a counter and as a subtype (path order: 'std-freecast' sorts after 'std-fra')
  ['zz-cloud/std-freecast-3.json', cloudStdFreecast3], // std-freecast-3: spells you cast that are one or more colors have web-slinging (path order: 'std-freecast' sorts after 'std-fra')
  ['zz-cloud/std-freecast-4.json', cloudStdFreecast4], // std-freecast-4: a face-up cost reduced for each <filter> (path order: 'std-freecast' sorts after 'std-fra')
  ['zz-cloud/std-freecast-5.json', cloudStdFreecast5], // std-freecast-5: plot from the top of your library (path order: after the other std-freecast files)
  ['zz-cloud/std-hob.json', cloudStdHob], // std-hob: the Standard backlog of The Hobbit set (hob): see the file's templates
  ['zz-cloud/std-lci.json', cloudStdLci], // std-lci (The Lost Caverns of Ixalan backlog): explores twice, mixed lists of kinds, ...
  ['zz-cloud/std-library-1.json', cloudStdLibrary1], // std-library-1 (account B lane std-library; path order: 'std-library-1' sorts after 'std-lci', before 'std-misc'): "put any number of <cards> with different powers from among them into your hand" (CR 208.1, 608.2d)
  ['zz-cloud/std-library-2.json', cloudStdLibrary2], // std-library-2 (lane std-library): "return another <card> to your hand", "each player may put any number of <cards> from their hand onto the battlefield", prevention reflexives
  ['zz-cloud/std-library-3.json', cloudStdLibrary3], // std-library-3 (account B lane std-library; path order: 'std-library-3' sorts after 'std-library-1' and 'std-lci', before 'std-misc'): "for each card type, you may exile a card of that type from among them" (CR 205.2a, 608.2d)
  ['zz-cloud/std-library-4.json', cloudStdLibrary4], // std-library-4 (lane std-library): "If you would pay life while your library has at least that many cards in it, exile that many cards ... instead" (the payLife proposal)
  ['zz-cloud/std-mana-1.json', cloudStdMana1], // std-mana-1 (lane std-mana; path order: 'std-mana-1' sorts after 'std-lci', before 'std-misc'): mana riders and mana abilities, see the file
  ['zz-cloud/std-mana-12.json', cloudStdMana12], // std-mana-12 (lane std-mana; path order: 'std-mana-12' sorts after 'std-lci', before 'std-misc'): colored cost reductions, mana abilities with more instructions, bending (CR 601.2f, 605, 701.65-701.67)
  ['zz-cloud/std-mana-2.json', cloudStdMana2], // std-mana-2 (lane std-mana; path order: 'std-mana-2' sorts after 'std-lci', before 'std-misc'): see the file
  ['zz-cloud/std-misc.json', cloudStdMisc], // std-misc: the Standard backlog of the commander and special sets (big, ecc, eoc, frc, inr, msc, soc, tdc, tle): see the file's templates
  ['zz-cloud/std-mkm.json', cloudStdMkm], // std-mkm: the Standard backlog of Murders at Karlov Manor (tuning half)
  ['zz-cloud/std-msh.json', cloudStdMsh], // std-msh (cloud batch 2, Standard backlog of msh): "until end of turn, ~'s base power and toughness become 6/6 and they gain trample", ...
  ['zz-cloud/std-otj.json', cloudStdOtj], // std-otj: the Outlaws of Thunder Junction backlog (tuning half): 'an additional ... for each' and scaled 'for each' pumps, search-then-top, half rounded up / down (sacrifice, discard), mill and lose life, destroy if no other creature has greater power, put a card from among the milled cards into your hand
  ['zz-cloud/std-r10.json', cloudStdR10], // Standard round 10 (path order: 'std-r10' sorts after 'std-otj', before 'std-sos'): "the next spell you cast this turn can't be countered" (CR 601.2i, 611.2)
  ['zz-cloud/std-r6.json', cloudStdR6], // std-r6: Standard round 6, single-sentence gaps of Standard cards: domain power, ...
  ['zz-cloud/std-r9.json', cloudStdR9], // std-r9: Standard round 9, new templates and template status: "you can't cast ~ during your first, second, or third turns of the game", "when you next attack this turn"
  ['zz-cloud/std-r9b.json', cloudStdR9b], // std-r9b: Standard round 9, second lane (cloud): a search of a player's graveyard, hand and library for cards with the same name as an object; all cards exiled with ~ into their owners' hands; the chosen creature type of a group
  ['zz-cloud/std-rD.json', cloudStdRD], // std-rD: Standard round D (slot D of five parallel rounds): choosing among listed card types
  ['zz-cloud/std-ra.json', cloudStdRa], // std-ra (Standard round, slot A of five parallel rounds): a group pumped for each counter of a kind on ~ (Banner of Kinship)
  ['zz-cloud/std-rb.json', cloudStdRb], // std-rB: Standard round B (slot B of five parallel rounds): see the file's templates
  ['zz-cloud/std-rc.json', cloudStdRc], // std-rc: Standard round C (slot C of the parallel rounds A-E): path order: 'std-rc' sorts after 'std-rb', before 'std-sos'; "This ability costs {X} less to activate, where X is ..." (CR 602.2b, 601.2f)
  ['zz-cloud/std-re.json', cloudStdRe], // std-re: Standard round E (path order: 'std-re' sorts after 'std-rc', before 'std-sos'): a search for three cards of three descriptions; "you scry N"; "you may cast an Ally spell from among cards you own exiled with ~" (one paid cast, CR 608.2g, 607.2a)
  ['zz-cloud/std-rf.json', cloudStdRf], // std-rf (Standard round F, slot F of F-J): spells cast from your hand have cascade, an Aura that makes the permanent a colorless land, "transforms into ~ and at ..." triggers
  ['zz-cloud/std-rg.json', cloudStdRg], // std-rg (Standard round G, slot G of the parallel rounds F-J; path order: 'std-rg' sorts after 'std-re', before 'std-rl'): see the file's templates
  ['zz-cloud/std-rh.json', cloudStdRh], // std-rh (Standard round H, slot H of the parallel rounds F-J): see the file's templates (path order: 'std-rh' sorts after 'std-re', before 'std-rl')
  ['zz-cloud/std-ri.json', cloudStdRi], // std-ri (Standard round I, slot I of the parallel rounds F-J): see the file's templates (path order: 'std-ri' sorts after 'std-re', before 'std-rl')
  ['zz-cloud/std-rj.json', cloudStdRj], // std-rj: Standard round J (slot J of the parallel rounds F-J): see the file's templates (path order: 'std-rj' sorts after 'std-ri', before 'std-rl')
  ['zz-cloud/std-rl.json', cloudStdRl], // std-rl: precon round L (slot L of the Commander-precon rounds): "enchanted|equipped creature gets +X/+X|-X/-X, where X is ..."
  ['zz-cloud/std-rm.json', cloudStdRm], // std-rm (Commander precon lane M, path order: 'std-rm' sorts after 'std-r9', before 'std-sos'): "<object> phases out", "<group> phase out" (CR 702.26), "<object> gets +N/+N for each <kind> counter you have" (CR 122.1)
  ['zz-cloud/std-rn.json', cloudStdRn], // std-rn: precon round N (slot N of the Commander-precon rounds; path order: 'std-rn' sorts after 'std-rm', before 'std-ro'): activation "during the <step>" of any turn (CR 602.5b), addendum "you cast ~ during your main phase" (CR 601.2i), "each player shuffles their [hand and] graveyard into their library[, then draws N cards]" (CR 701.24a)
  ['zz-cloud/std-ro.json', cloudStdRo], // std-ro: precon round O (path order: 'std-ro' sorts after 'std-r9', before 'std-sos'): "put all <cards> revealed this way into your hand and the rest ..." (CR 701.20a, 608.2c)
  ['zz-cloud/std-rp.json', cloudStdRp], // std-rp: Standard round P (Commander precon cards, tuning half; path order: 'std-rp' sorts after 'std-re', before 'std-sos'): "prevent all damage that would be dealt to <filter>" as a static ability (CR 615.1)
  ['zz-cloud/std-rq.json', cloudStdRq], // std-rq: Standard round std-rq (card wave 2, slice s1; path order: 'std-rq' sorts after 'std-rp', before 'std-sos'): "<object> gets +N/+M <duration> for each <filter>" with any P/T (CR 611.2a, 613.4c)
  ['zz-cloud/std-rr.json', cloudStdRr], // std-rr: wave 2 slice s2 (path order: 'std-rr' sorts after 'std-rq', before 'std-sos'): "its base power and toughness become equal to <object>'s power and toughness <duration>" (CR 613.4b)
  ['zz-cloud/std-rs.json', cloudStdRs], // std-rs: Standard round S (wave 2 slice s3; path order: 'std-rs' sorts after 'std-rp', before 'std-sos'): "<player> exiles cards from the top of their library until they exile <card>", "you may cast a card exiled with ~ without paying its mana cost" (CR 607.2a)
  ['zz-cloud/std-rt.json', cloudStdRt], // std-rt: Standard card wave 2, slice s4 (path order: 'std-rt' sorts after 'std-rq', before 'std-sos'): "until the end of your next turn, whenever E, X" (a delayed trigger with that duration, CR 603.7b, 611.2a)
  ['zz-cloud/std-ru.json', cloudStdRu], // std-ru: card wave 2, slice s5 (path order: 'std-ru' sorts after 'std-rp', before 'std-sos'): a dig that reveals one card, then "you may put it onto the battlefield if C"; "as long as C, ~ can't be attacked and has ..."; "during your turn, you may play cards exiled with ~" with its life cost
  ['zz-cloud/std-rw6.json', cloudStdRw6], // std-rw6: card wave 2, slice s6 (path order: 'std-rw6' sorts after 'std-rp', before 'std-sos'): "each opponent may discard a card or sacrifice a <permanent>" with "<src> deals N damage to each opponent who didn't"
  ['zz-cloud/std-rw7.json', cloudStdRw7], // std-rw7: card wave 2 slice s7 (path order: 'std-rw7' sorts after 'std-rp', before 'std-sos'): "you may cast a <spell> from your hand without paying its mana cost" / "from your graveyard" during a resolution (CR 608.2g); "If an instant or sorcery spell cast this way would be put into your graveyard, exile it instead" (CR 614.1a)
  ['zz-cloud/std-rw8.json', cloudStdRw8], // std-rw8: card wave 2 slice s8 (path order: 'std-rw8' sorts after 'std-rp', before 'std-sos'): an activation cost part that is a choice between two costs, "Sacrifice an artifact or discard a nonland card" (CR 601.2b, 602.2b)
  ['zz-cloud/std-rw9.json', cloudStdRw9], // std-rw9: card wave 2, slice s9 (path order: 'std-rw9' sorts after 'std-rw6', before 'std-sos'): any number of <cards> from among them onto the battlefield tapped and the rest into your graveyard
  ['zz-cloud/std-rx1.json', cloudStdRx1], // std-rx1: Standard round rx1 (wave 2 slice s26; path order: 'std-rx1' sorts after 'std-rp', before 'std-sos'): "during combat, players can't cast spells or activate abilities that aren't mana abilities"
  ['zz-cloud/std-rx10.json', cloudStdRx10], // std-rx10 (wave 2, slice s17; path order: 'std-rx10' sorts after 'std-rp', before 'std-sos'): "choose target A and target B", "those creatures fight each other"
  ['zz-cloud/std-rx11.json', cloudStdRx11], // std-rx11: card wave 2, slice s16 (path order: 'std-rx11' sorts after 'std-rw6', before 'std-sos'): "whenever <obj> deals combat damage this turn, X" (a delayed trigger, any recipient)
  ['zz-cloud/std-rx12.json', cloudStdRx12], // std-rx12: card wave 2, slice s15 (path order: 'std-rx12' sorts after 'std-rw6', before 'std-sos'): "~ has <abilities> as long as it hasn't dealt damage yet" (CR 611.3a, 120.1, 400.7)
  ['zz-cloud/std-rx13.json', cloudStdRx13], // std-rx13: card wave 2, slice s14 (path order: 'std-rx13' sorts after 'std-rx12', before 'std-rx3'): "You may choose not to untap ~ during your untap step" (rule mayNotUntap, CR 502.3)
  ['zz-cloud/std-rx14.json', cloudStdRx14], // std-rx14: card wave 2, slice s13 (path order: 'std-rx14' sorts after 'std-rx13', before 'std-rx18'): "remove a <kind> counter from each of any number of <permanents>"
  ['zz-cloud/std-rx15.json', cloudStdRx15], // std-rx15 (wave 2, slice s12; path order: 'std-rx15' sorts after 'std-rx14', before 'std-rx3'): "<obj> becomes a <subtypes> with base power and toughness N/M [and <abilities>]" with no duration (CR 611.2a, 205.1b, 613.4b)
  ['zz-cloud/std-rx16.json', cloudStdRx16], // std-rx16 (wave 2, slice s11; path order: 'std-rx16' sorts after 'std-rx15', before 'std-rx18'): "each <spell> you cast with toughness greater than its power costs {N} less to cast" (CR 208.1, 601.2f)
  ['zz-cloud/std-rx18.json', cloudStdRx18], // std-rx18 (wave 2, Commander precon lane rx18; path order: 'std-rx18' sorts after 'std-rw6', before 'std-rx9'): "<obj> becomes an artifact in addition to its other types", attached base P/T with abilities, see the file
  ['zz-cloud/std-rx19.json', cloudStdRx19], // std-rx19 (wave 2, precon lane rx19; path order: 'std-rx19' sorts after 'std-rw6', before 'std-rx9'): "Whenever you cast your first spell during each opponent's turn" (CR 601.2i, 603.2)
  ['zz-cloud/std-rx2.json', cloudStdRx2], // std-rx2: wave 2 slice s25 (path order: 'std-rx2' sorts after 'std-rx19', before 'std-rx20'): "if a creature attacking causes a triggered ability ... to trigger, that ability triggers an additional time" (CR 603.2d, 508.1m)
  ['zz-cloud/std-rx20.json', cloudStdRx20], // std-rx20: wave 2, Commander lane rx20 (path order: 'std-rx20' sorts after 'std-rx19', before 'std-rx21'): a bare "search your library for <SearchDesc>" (CR 701.23a), "If <Cond>, ~ enters tapped" (CR 614.1c), "scry X, where X is <Qty>" (CR 701.22a)
  ['zz-cloud/std-rx21.json', cloudStdRx21], // std-rx21: EDH lane rx21 (path order: 'std-rx21' sorts after 'std-rx12', before 'std-rx3'): "<player> can't cast <spells>", "<player> can't play lands" (CR 601.3, 305.2), "gains protection from colorless or from the color of your choice" (CR 702.16a), "<object> can't be the target of spells or abilities your opponents control" (CR 115.1)
  ['zz-cloud/std-rx22.json', cloudStdRx22], // std-rx22: card wave 2, EDH lane rx22 (path order: 'std-rx22' sorts after 'std-rx12', before 'std-sos'): "counter <spell> if <Cond>" (CR 701.6a, 608.2c)
  ['zz-cloud/std-rx23.json', cloudStdRx23], // std-rx23: card wave 2, EDHREC lane rx23 (path order: 'std-rx23' sorts after 'std-rx22', before 'std-rx24'): "prevent all [combat] damage that would be dealt [this turn] by <group> [this turn]" (CR 615.1a)
  ['zz-cloud/std-rx24.json', cloudStdRx24], // std-rx24 (wave 2, EDH lane rx24; path order: 'std-rx24' sorts after 'std-rx18', before 'std-rx3'): "~ enters with your choice of a <kind> counter or a <kind> counter on it"
  ['zz-cloud/std-rx25.json', cloudStdRx25], // std-rx25 (wave 2, EDH lane rx25; path order: 'std-rx25' sorts after 'std-rx24', before 'std-rx3'): "whenever you cycle another card", see the file
  ['zz-cloud/std-rx26.json', cloudStdRx26], // std-rx26: card wave 2, slice s10 (path order: 'std-rx26' sorts after 'std-rx24', before 'std-rx3'): "the next <spell> you cast this turn has affinity for <filter> | convoke | improvise" (CR 601.2a, 601.2f, 613.1f)
  ['zz-cloud/std-rx27.json', cloudStdRx27], // std-rx27 (wave 2, Standard lane rx27, cast and play permissions; path order: 'std-rx27' sorts after 'std-rx19', before 'std-rx3'): static linked cast permissions with riders (flash, any type of mana, owner and qualities, "enters with", once each turn, free)
  ['zz-cloud/std-rx28.json', cloudStdRx28], // std-rx28 (wave 2, Standard lane rx28; path order: 'std-rx28' sorts after 'std-rx19', before 'std-rx3'): "As ~ enters, look at an opponent's hand, then choose a card type other than creature"
  ['zz-cloud/std-rx29.json', cloudStdRx29], // std-rx29 (wave 2, Standard lane rx29, computed quantities; path order: 'std-rx29' sorts after 'std-rx19', before 'std-rx3'): "choose exactly N <permanents> you control", see the file
  ['zz-cloud/std-rx3.json', cloudStdRx3], // std-rx3: Standard round rx3 (wave 2, slice s24; path order: 'std-rx3' sorts after 'std-rp', before 'std-sos'): a search for any number of cards (CR 701.23a)
  ['zz-cloud/std-rx30.json', cloudStdRx30], // std-rx30 (wave 2, lane rx30: other players' choices and per-player effects; path order: 'std-rx30' sorts after 'std-rx3', before 'std-rx5'): see the file's templates
  ['zz-cloud/std-rx31.json', cloudStdRx31], // std-rx31 (wave 2, Standard lane rx31: exile, copies and returns; path order: 'std-rx31' sorts after 'std-rx3', before 'std-rx5'): see the file
  ['zz-cloud/std-rx32.json', cloudStdRx32], // std-rx32 (wave 2, Standard lane rx32; path order: 'std-rx32' sorts after 'std-rx3' ('2' > '.'), before 'std-rx5'): durations of the affected object (whileObject), see the file
  ['zz-cloud/std-rx33.json', cloudStdRx33], // std-rx33: EDH lane rx33 (path order: 'std-rx33' sorts after 'std-rx3', before 'std-rx5'): "<src> deals N damage to <recipient> and M damage to each <filter>" (CR 120.1)
  ['zz-cloud/std-rx34.json', cloudStdRx34], // std-rx34: EDH lane rx34 (path order: 'std-rx34' sorts after 'std-rx3', before 'std-rx5'): "<object> becomes the color of your choice <duration>" (CR 105.3, 608.2d), "during turns other than yours, <objects> get +N/+N" (CR 611.3a, 500.1)
  ['zz-cloud/std-rx35.json', cloudStdRx35], // std-rx35: EDH lane rx35 (path order: 'std-rx35' sorts after 'std-rx3', before 'std-rx5'): "put N cards from your hand on the bottom of your library" (CR 401.4), see the file
  ['zz-cloud/std-rx5.json', cloudStdRx5], // std-rx5: wave-2 slice s22 (path order: 'std-rx5' sorts after 'std-rp', before 'std-sos'): "put <cards> onto the battlefield tapped under your control with N additional counters on it", "becomes a P/T <subtypes> artifact creature" (no duration), "As ~ enters, choose a number between N and M"
  ['zz-cloud/std-rx6.json', cloudStdRx6], // std-rx6: wave-2 slice s21: "As ~ enters, choose a card name" (and the look at an opponent's hand first); activated abilities of a group can't be activated unless they're mana abilities; "<group> can't attack you [or block <group>]"
  ['zz-cloud/std-rx7.json', cloudStdRx7], // std-rx7: wave 2 slice s20 (path order: 'std-rx7' sorts after 'std-rw6', before 'std-sos'): "Each <spells> you cast has casualty N" (CR 702.153a)
  ['zz-cloud/std-rx8.json', cloudStdRx8], // std-rx8: card wave 2, slice s19 (path order: 'std-rx8' sorts after 'std-rx7', before 'std-rx9'): "exile cards equal to <Qty> from the top of <player>'s library"
  ['zz-cloud/std-rx9.json', cloudStdRx9], // std-rx9 (wave 2, slice s18; path order: 'std-rx9' sorts after 'std-rp', before 'std-sos'): "As ~ enters, choose a basic land type. Then you may <cost>. If you don't, it enters tapped."; "~ is the chosen type" (a basic land type set, CR 305.7)
  ['zz-cloud/std-ry10.json', cloudStdRy10], // std-ry10 (wave 2, Commander lane ry10; path order: 'std-ry10' sorts after 'std-rx9', before 'std-sos'): "prevent all combat damage that would be dealt to and dealt by <obj> <dur>" (CR 615.1a), "If ~ would die, exile it instead" (CR 614.1a)
  ['zz-cloud/std-ry3.json', cloudStdRy3], // std-ry3 (wave 2, Commander lane ry3; path order: 'std-ry3' sorts after 'std-rx9', before 'std-sos'): "<player> skips their next combat phase" (a one-use skip shield, CR 614.10a)
  ['zz-cloud/std-ry4.json', cloudStdRy4], // std-ry4 (wave 2 top-down, Commander lane ry4; path order: 'std-ry4' sorts after 'std-ry10', before 'std-sos'): "you may have <object(s)> gain <abilities> <duration>" (CR 603.5, 613.1f)
  ['zz-cloud/std-ry5.json', cloudStdRy5], // std-ry5 (wave 2, Commander fresh lane ry5; path order: 'std-ry5' sorts after 'std-ry10', before 'std-sos'): "you skip your next [two] turn(s)" (CR 614.10)
  ['zz-cloud/std-ry6.json', cloudStdRy6], // std-ry6 (wave 2, Commander lane ry6; path order: 'std-ry6' sorts after 'std-ry10', before 'std-sos'): "~ can't attack alone", "~ can't block alone" (CR 506.5)
  ['zz-cloud/std-ry8.json', cloudStdRy8], // std-ry8 (wave 2, Commander lane ry8; path order: 'std-ry8' sorts after 'std-ry6', before 'std-sos'): "You may exert ~ as it attacks. [When you do, X.]" (rule mayExertAsAttacks, CR 701.43a, 603.12)
  ['zz-cloud/std-sos.json', cloudStdSos], // std-sos: the not-full Standard cards of Secrets of Strixhaven (tuning half): searches for N cards, ...
  ['zz-cloud/std-spm.json', cloudStdSpm], // std-spm: the Standard backlog of Marvel's Spider-Man (spm): see the file's templates
  ['zz-cloud/std-tdm.json', cloudStdTdm], // std-tdm: the Standard backlog of Tarkir: Dragonstorm (tdm): see the file's templates (path order: 'std-tdm' sorts after 'std-otj')
  ['zz-cloud/std-tla.json', cloudStdTla], // std-tla: the Standard backlog of Avatar: The Last Airbender (tla): see the file's templates
  ['zz-cloud/std-tmt.json', cloudStdTmt], // std-tmt: the Teenage Mutant Ninja Turtles backlog (tmt, tuning half): see the file's templates
  ['zz-cloud/std-typechange-1.json', cloudStdTypechange1], // std-typechange-1 (lane std-typechange; path order: 'std-ty' sorts after 'std-tmt', before 'std-woe'): type and ability changes, see the file
  ['zz-cloud/std-typechange-2.json', cloudStdTypechange2], // std-typechange-2 (lane std-typechange; path order: 'std-ty' sorts after 'std-tmt', before 'std-woe'): see the file
  ['zz-cloud/std-woe.json', cloudStdWoe], // std-woe: the Standard backlog of Wilds of Eldraine (woe): see the file's templates
  ['zz-cloud/trek-1.json', cloudTrek1], // trek-1 (lane trek, Star Trek; path order: 'trek' sorts after 'std-woe', before zz-fast1/): beam me up, assimilate, "gets +N/+N and becomes a <type>"
  ['zz-cloud/trek-11.json', cloudTrek11], // trek-11 (lane trek; path order: 'trek-11' sorts after 'trek-1.json', before 'trek-2'): "Once during each of your turns, you may play a permanent card you own from outside the game or from your graveyard" (CR 400.11, 305.1, 601.3)
  ['zz-cloud/trek-12.json', cloudTrek12], // trek-12 (lane trek; path order: 'trek-12' sorts after 'trek-1', before 'trek-2'): "create a copy of ~" of the card an exile-only ability is on (with r4-copy's "you may cast the copy")
  ['zz-cloud/trek-2.json', cloudTrek2], // trek-2 (lane trek; path order: 'trek-2' sorts after 'std-woe', before zz-fast1/): "if you gaining life causes a triggered ability ... to trigger" (CR 603.2d)
  ['zz-cloud/trek-3.json', cloudTrek3], // trek-3 (lane trek, Star Trek cards; path order: 'trek-3' sorts after 'std-woe', before zz-fast1/): "<obj> [also] gains <abilities> <dur> if <cond>", "<player> exiles that card, then draws a card", "<player> may search their library for a <card>, reveal it, put it into their hand, then shuffle"
  ['zz-cloud/trek-4.json', cloudTrek4], // trek-4 (lane trek; path order: 'trek-4' sorts after 'std-woe', before zz-fast1/): "If you do, it enters with additional counters ... the copied permanent has on it" (CR 614.1c), "<permanents> can't phase in" (CR 702.26c)
  ['zz-cloud/trek-5.json', cloudTrek5], // trek-5 (lane trek, Star Trek cards; path order: 'trek-5' sorts after 'std-woe', before zz-fast1/): "You have no maximum hand size <dur>", "double <player>'s life total", "<player> can't sacrifice <filter>", "~'s base power and toughness become N/M"
  ['zz-cloud/trek-6.json', cloudTrek6], // trek-6 (lane trek; path order: 'trek-6' sorts after 'trek-4', before zz-fast1/): "If you would put one or more [kind] counters on <permanent>, put twice that many ... on that <permanent> instead" (CR 614.1a, 122.6)
  ['zz-cloud/trek-7.json', cloudTrek7], // trek-7 (lane trek, Star Trek cards; path order: 'trek-7' sorts after 'trek-4', before zz-fast1/): "you may cast ~ from exile", beam me up granted to the cards of a graveyard, owner's permission to play an exiled card, assimilate after an exile-until
  ['zz-cloud/trek-8.json', cloudTrek8], // trek-8 (lane trek; path order: 'trek-8' sorts after 'std-woe', before zz-fast1/): see the file's templates
  ['zz-cloud/trek-9.json', cloudTrek9], // trek-9 (lane trek; path order: 'trek-9' sorts after 'trek-4', before zz-fast1/): library, graveyard and Star Trek odd ones
  // FAST1 (docs/ROADMAP.md): one file per template package under zz-fast1/ (path order puts it before zz-push/)
  ['zz-fast1/t4.json', fast1T4], // T4: triggered and activated ability shapes
  ['zz-fast1/t5.json', fast1T5], // T5: static and continuous ability shapes
  ['zz-fast1/t6.json', fast1T6], // T6: one-shot spell and ETB effect shapes (family C)
  // FAST2 (docs/ROADMAP.md): one file per template package under zz-fast2/ (path order: after zz-fast1/, before zz-push/; t10 sorts before t7)
  ['zz-fast2/t10.json', fast2T10], // T10: library searches, zone moves, event-bound and anaphoric object instructions
  ['zz-fast2/t7.json', fast2T7], // T7: mana abilities, cost modifiers, keyword lines and conditional statics
  ['zz-fast2/t8.json', fast2T8], // T8: one-shot damage, life, draws, counters and keyword actions
  ['zz-fast2/t9.json', fast2T9], // T9: continuous effects (until-end-of-turn P/T, abilities, types and colors), P/T statics and lords
  // FAST3 (docs/ROADMAP.md): one file per template package under zz-fast3/ (path order: after zz-fast2/, before zz-push/)
  ['zz-fast3/t11.json', fast3T11], // T11: cost modifiers and mana abilities with counted costs
  ['zz-fast3/t12.json', fast3T12], // T12: static P/T, keywords and characteristic-defining counts with conditions; simple block restrictions
  ['zz-fast3/t13.json', fast3T13], // T13: type, color and ability changes and their choices (layers 4-6 resolved effects and Aura statics)
  ['zz-fast3/t14.json', fast3T14], // T14: pay-or-sacrifice and counter-unless payments, graveyard and library targets, combat-damage-bound triggers
  ['zz-fast3/t15.json', fast3T15], // T15: player rules (can't gain life, can't cast during your turn, player hexproof and shroud), cast-as-though-flash permissions, enters-tapped and enters-with statics
  ['zz-fast3/t16.json', fast3T16], // T16: combat and targeting restrictions on objects (R2-B)
  ['zz-fast3/t17.json', fast3T17], // T17: token creation with computed counts, choices and Roles; library searches with reveal and put references
  ['zz-fast3/t18.json', fast3T18], // T18: effects whose object or amount is a reference (it, them, those, that much, the sacrificed creature)
  // FAST4 (docs/ROADMAP.md): one file per template package under zz-fast4/ (path order: after zz-fast3/, before zz-m6/)
  ['zz-fast4/mx2.json', fast4Mx2], // MX2: exchange of control, protection from a chosen quality, own-and-control conditions, Vesuvan Doppelganger
  ['zz-fast4/t19.json', fast4T19], // T19: replacement, prevention, redirection and game-end shapes (M6-1 bodies)
  ['zz-fast4/t20.json', fast4T20], // T20: tap and stun, untap, phase out and one-shot keyword-action shapes
  ['zz-fast4/t21.json', fast4T21], // T21: cost modifiers with repeated or target-dependent amounts, spells that target ~, a casting-timing restriction
  ['zz-fast4/t22.json', fast4T22], // T22: power/toughness, counters and keyword-grant shapes (doubling, for each attached, put counters where X is)
  ['zz-fast4/t23.json', fast4T23], // T23: trigger clauses (cast a colored spell or a permanent enters, both colors, the chosen color) and base P/T with a keyword
  ['zz-fast4/t24.json', fast4T24], // T24: statics for spell keyword grants, attack/block permissions, restrictions and conditional P/T
  ['zz-fast4/t25.json', fast4T25], // T25: one-shot effects on permanents and spells: damage, removal, control, prevention shields
  ['zz-fast4/t26.json', fast4T26], // T26: one-shot effects on cards, life and tokens with back-references and counted quantities (draw then discard of them, that many, where X is)
  ['zz-fast4/t27.json', fast4T27], // T27: trigger clauses with a condition of the event (while, during a turn), first time each turn, and their intervening ifs
  ['zz-fast4/t28.json', fast4T28], // T28: +1/+1 and keyword counters: put on several objects, move a left object's counters, double, distribute, enters with (additional) counters
  ['zz-fast4/t29.json', fast4T29], // T29: P/T and keyword statics (self, equipped, enchanted, lords, job Equipment) and pumps with a computed X
  ['zz-fast4/t30.json', fast4T30], // T30: one-shot damage, life loss, drawing, milling, bounce, tutors and removal (two damage recipients, half rounded up, may have target player, search with mana value)
  ['zz-fast4/t31.json', fast4T31], // T31: zone moves: tutor variants, flicker, reanimation, impulse-play permissions, library reorder, counter removal
  ['zz-fast4/t32.json', fast4T32], // T32: casting statics: conditional cost modifiers, alternative and free costs, cast restrictions
  ['zz-fast4/t33.json', fast4T33], // T33: permanent statics: aura and equipment restrictions and type changes, evasion and blocking statics, combat pump riders
  ['zz-fast4/t34.json', fast4T34], // T34: one-shot player effects: punisher choices, life lost and spell-count quantities, divided damage, wheels, 'if it was ...' riders
  // FAST5 (docs/ROADMAP.md): one file per template package under zz-fast5/ (path order: after zz-fast4/, before zz-m6/)
  ['zz-fast5/mx3.json', fast5Mx3], // MX3: the Ring tempts you, Ring-bearers (CR 701.54)
  ['zz-fast5/mx4.json', fast5Mx4], // MX4: venture into the dungeon, the initiative, "whenever you complete a dungeon" (CR 701.49, 726, 309.7)
  ['zz-fast5/mx5.json', fast5Mx5], // MX5: block, activation and untap riders ("doesn't untap during its controller's next untap step")
  ['zz-fast5/mx6.json', fast5Mx6], // MX6: endure (CR 701.63), earthbend (CR 701.66), empower Jace N
  ['zz-fast5/mx7.json', fast5Mx7], // FAST5 MX7: learn (CR 701.48a)
  ['zz-fast5/t35.json', fast5T35], // T35: keyword-ability lines with costs and thresholds (for mirrodin!, power-up, station)
  ['zz-fast5/t36.json', fast5T36], // T36: prevention, next-spell and spell-cast restrictions
  ['zz-fast5/t37.json', fast5T37], // T37: monstrosity, 'assign combat damage as though it weren't blocked', colors-spent counters and other static shapes
  ['zz-fast5/t38.json', fast5T38], // T38: cost reductions (a party, bargain, an ability's cost), mana added of a produced type, storage counters, Attractions
  ['zz-fast5/t39.json', fast5T39], // T39: Role tokens (Monster, Young Hero, Sorcerer) attached to an object; enchanted creatures you control
  ['zz-fast5/t40.json', fast5T40], // T40: replacement, prevention and trigger-doubling variants (damage of a filtered source doubled or raised, life loss, counters, prevention)
  ['zz-fast5/t41.json', fast5T41], // T41: until-end-of-turn grants and compound pump / grant / type changes ("that many" draw and life loss, each of several targets, in addition to its other types, two pumps, loses all creature types, a choice of two keywords, a counter and a grant, double the power of)
  ['zz-fast5/t42.json', fast5T42], // T42: returns and searches with relative mana value, distinct names, attached or transformed entry
  ['zz-fast5/t43.json', fast5T43], // T43: library dig: look at or reveal the top N cards, choose from among them, put the rest on the bottom or into the graveyard
  ['zz-fast5/t44.json', fast5T44], // T44: optional costs during resolution (you may sacrifice another, pay life, exile from your graveyard) with their if-you-do followers
  ['zz-fast5/t45.json', fast5T45], // T45: copy spells and abilities: 'when you next cast ... copy that spell', copies, new targets for the copies, copy target ability
  ['zz-fast5/t46.json', fast5T46], // T46: hand disruption: reveal or look at a hand, choose a card from it, that player discards it or you exile it (CR 701.20, 701.9)
  ['zz-fast5/t47.json', fast5T47], // T47: 'becomes a creature' animation, 'it's still a land' riders, Enduring return as an enchantment
  ['zz-fast5/t48.json', fast5T48], // T48: mana-spend restrictions, four mana in any combination, X of one of two colors, a mana per color among permanents, exiled cards' colors, Heartwood tokens
  ['zz-fast5/t49.json', fast5T49], // T49: damage with computed amounts, split recipients, each-deals-its-power, 'then' damage
  ['zz-fast5/t50.json', fast5T50], // T50: turn-scoped delayed triggers: 'until end of turn, whenever ...', 'whenever ... this turn', 'when it dies this turn'
  ['zz-fast5/t51.json', fast5T51], // T51: mana spent to cast: pumps 'for each color of mana spent to cast that spell', 'enters with a number of counters equal to the amount of mana spent to cast it'
  ['zz-fast5/t52.json', fast5T52], // T52: Delirium-style 'N or more card types among cards in your graveyard' (CR 205.2a): leading-condition anthems, hand size, draw X
  ['zz-fast5/t53.json', fast5T53], // T53: investigate once for each opponent who has more cards in hand than you (CR 402.1, 701.16a)
  ['zz-fast5/t54.json', fast5T54], // T54: station rows with abilities (CR 721.2): an artifact becomes an artifact creature with base power and toughness and gains abilities
  ['zz-fast5/t55.json', fast5T55], // T55: tokens with quoted abilities, keyword-N riders and names (Mercenary, Spirit, Drone, legendary named tokens, named Equipment tokens)
  ['zz-fast5/t56.json', fast5T56], // T56: spell riders: discard-unless, fight follow-ups, counter-exile, granted flashback cost, wheel-N
  ['zz-fast5/t57.json', fast5T57], // T57: static and land riders: a land that enters tapped and chooses a color, "can't be blocked except by N or more creatures", "can't be blocked by <filter> this turn", "damage can't be prevented this turn", lockdown Auras (loses all abilities and doesn't untap), identity Auras (a subtype with base power and toughness, loses all abilities)
  ['zz-fast5/t58.json', fast5T58], // T58: short names that are subtypes (CR 201.5c, 205.3j); "draw a card for each color among", counters on a target "if it's a <type>"
  ['zz-fast5/t59.json', fast5T59], // T59: R6-A removal and counterspell filters: counter unless a counted cost, 'destroy it' after two events, stun counters on those targets, shuffle into owners' libraries, return a spell or creature
  ['zz-fast5/t60.json', fast5T60], // T60: static continuous grants: equipment that loses, types and grants quoted abilities, spells you cast have delve or affinity, toughness assigns combat damage, base P/T from life or a count
  ['zz-fast5/t61.json', fast5T61], // T61: resolution riders: 'then draw', 'if you control that <type>, draw', untap that land, counters on each / for each, if-you-do counter and draw, delayed return, mill and take all
  ['zz-fast5/t62.json', fast5T62], // T62: trigger clauses and intervening-if shapes: another outlaw, 'and when you sacrifice it', turned face up, exhaust activations, noncombat damage to opponents, becomes a creature in addition to its other types
  ['zz-fast5/t63.json', fast5T63], // T63: casting permissions and free casts (a noncreature spell from your hand, a card from your graveyard this turn), first-spell cost and flash statics, history-conditioned cost and evasion statics, conditional enters tapped
  ['zz-fast5/t64.json', fast5T64], // T64: copy effects: token copies with an added subtype, 'becomes a copy' of one or several permanents, enters as a copy with a kept name or from a graveyard, copies of the entering permanent, one copy per target
  ['zz-fast5/t65.json', fast5T65], // T65: counter placement and card-draw steps (a keyword counter with +1/+1 counters, distribute-then-double, 'without dying' leaves, explores X times, ...)
  ['zz-fast5/t66.json', fast5T66], // T66: removal, control change and library/graveyard-to-battlefield shapes (isn't-a lists, shuffle into library, manifest dread by another player, total mana value)
  ['zz-fast5/t67.json', fast5T67], // T67: counted token creation ("for each X, create", tapped, per counter on ~), "Choose a creature type." with "of that type" (parser/lower/links.ts), "each X gets" pumps, emblems (CR 111.1, 114, 608.2c-d)
  ['zz-fast5/t68.json', fast5T68], // T68: counter-threshold type changes (War Balloon), nonbasic lands are Mountains (Zhao), pump per color among a group, base P/T grants to enchanted creatures, "during your turn, ~ and X have", "~ can't be sacrificed", "each X can't attack you or planeswalkers you control", "as long as you own a card in exile that has an Adventure"
  ['zz-fast5/t69.json', fast5T69], // T69: one-shot 'becomes' effects, base power setting and X-quantified pumps
  ['zz-fast5/t70.json', fast5T70], // T70: impulse play permissions (plural, a leading 'until end of turn', until you exile another card with ~), 'then if' cast-origin and prepared follow-ups, X from a sacrificed permanent's mana value
  ['zz-fast5/t71.json', fast5T71], // T71: mill N cards, then put / return a card from among them (into your hand, on top of your library)
  ['zz-fast5/t72.json', fast5T72], // T72: a leading until-end-of-turn with base power and toughness; becomes an artifact (creature), a Golem artifact creature in addition to its other types
  ['zz-fast5/t74.json', fast5T74], // T74: another player (its controller, that land's controller, that player) may search for a basic land card and put it onto the battlefield (tapped); that many; gains life, then searches
  ['zz-fast5/t75.json', fast5T75], // T75: look at / reveal the top N, then pick a card from among them with a richer filter (two descriptions joined by "or", {X} in the mana cost, noncreature nonland, a random card, a mana value against a count), searches for one of two kinds of card
  ['zz-fast5/t76.json', fast5T76], // T76: pronoun antecedents after counters, tokens and blinks (the focus rule, model/focus.ts): a permanent "it gains haste", "they gain menace and haste until end of turn", "sacrifice them", "if it's a creature, it also has base power and toughness"
  ['zz-fast5/t77.json', fast5T77], // T77: type-adding effects: 'it's / it becomes / that creature is a <subtype> in addition to its other types' after a move, 'they are 5/5 Elemental creatures', Phantom Train, Puppet Crafting, Beorn's Hospitality, all colors, every basic land type, Hydro-Man, equipment that adds a subtype and a quoted ability
  ['zz-fast5/t78.json', fast5T78], // T78: optional cost-like instructions followed by 'if you do' / 'when you do': tap N untapped, 'then you may sacrifice', pay life equal to its power, discard or sacrifice, 'draw a card and' riders (pinned scope), lookbacks
  // FAST5X (docs/ROADMAP.md): engine mechanic packages, one file per package under zz-fast5x/ (path order: after zz-fast4/ and zz-fast5/, before zz-m6/)
  ['zz-fast5x/e1.json', fast5xE1], // E1: optional cast-time costs with a resolution flag: gift, bargain, spree (CR 702.174, 702.166, 702.172)
  ['zz-fast5x/e10.json', fast5xE10], // E10 (path order: e10 sorts after e1): waterbend and airbend (CR 701.67, 701.65): "unless you waterbend {N}", airbend effects, "whenever you waterbend"
  ['zz-fast5x/e11.json', fast5xE11], // E11: behold, teamwork and tiered (CR 701.4, 702.194, 702.183): 'if a <quality> was beheld', 'cast using teamwork', counter-unless amounts replaced
  ['zz-fast5x/e12.json', fast5xE12], // E12: suspect and collect evidence (CR 701.60, 701.59): suspect X, collect evidence N, "if evidence was collected"
  ['zz-fast5x/e13.json', fast5xE13], // E13 (path order: e13 sorts after e1): craft (CR 702.167), "Exile ~" costs (CR 118.3, 602.2), finality counters (CR 122.1h) and graveyard returns with a counter
  // E14 sorts here (path order: 'e14' before 'e2')
  ['zz-fast5x/e14.json', fast5xE14], // E14: the top of your library: look at it any time, play and cast from it (CR 401.5, 601.3, 305.1)
  ['zz-fast5x/e15.json', fast5xE15], // E15 (MX18): the greatest / least <stat> among a set, "with the greatest <stat> among", "N or Q, whichever is greater" (CR 208.1, 202.3, 608.2d) (path order: e15 sorts before e2)
  ['zz-fast5x/e16.json', fast5xE16], // E16: excess damage (CR 120.4a, 120.10): "one or more ... are dealt excess [noncombat] damage" triggers, amass X where X is the excess (the quantity and condition are in the Qty and Cond holes, parser/holes/excess.ts)
  ['zz-fast5x/e17.json', fast5xE17], // E17 (path order: e17 sorts after e1): resolution history and last-known control: "if this is the first time this ability has resolved this turn", "if you controlled it", survival's second main phase
  ['zz-fast5x/e18.json', fast5xE18], // E18 (path order: e18 sorts before e2): recruit (reminder text, connive's shape) and Storied's enduring story (reminder text, ascend's CR 702.131b-c)
  ['zz-fast5x/e19.json', fast5xE19], // E19 (path order: e19 sorts after e1): mana spent to cast a spell (opus, CR 601.2h, 207.2c), unspent mana that isn't lost (CR 106.4, 500.5, 614.1)
  ['zz-fast5x/e2.json', fast5xE2], // E2: warp and void (CR 702.185, 207.2c): "X instead if C" self-replacements, "draw another card"
  ['zz-fast5x/e20.json', fast5xE20], // E20 (path order: e20 sorts after e2): commit a crime, outlaws, expend N, exhaust and loyalty activations, tapping an opponent's creature (CR 700.12-700.14, 702.177, 606.3, 701.26a)
  // E21 sorts here (path order: 'e21' after 'e2', before 'e3')
  ['zz-fast5x/e21.json', fast5xE21], // E21: counters II (CR 122.6, 122.8, 603.4, 603.8, 603.10a): who put the counters, the Nth counter, counters of a creature that left and moving them
  // E22 sorts here (path order: 'e22' after 'e2', before 'e3')
  ['zz-fast5x/e22.json', fast5xE22], // E22: descend and turn history II (CR 700.11, 207.2c, 603.4, 603.2c): graveyard-leave triggers during your turn, "an additional" P/T while descended 8, -X/-0 where X
  ['zz-fast5x/e23.json', fast5xE23], // E23 (path order: e23 sorts after e22, before e24): mana spending restrictions as general filters (CR 106.6): spells of a description, abilities of sources, equip abilities, turning face up, "can't be spent to cast"
  ['zz-fast5x/e24.json', fast5xE24], // E24 (path order: e24 sorts after e2): gendered pronouns of a character card as "~" (CR 201.5, design 6.4; parser/front/selfref.ts): enters with counters on ~, returns under ~'s owner's control, ~'s owner shuffles ~
  ['zz-fast5x/e25.json', fast5xE25], // E25: face-down II (CR 701.40, 701.58, 701.62, 708, 406.3): manifest dread by another player, cloak from a hand or a look, the manifested object as 'that creature', exiled face down, looking at face-down permanents, 'can't be turned face up'
  ['zz-fast5x/e26.json', fast5xE26], // E26 (path order: e26 sorts after e24, before e3): casting keywords impending, paradigm, improvise, miracle, hideaway (CR 702.176, 702.192, 702.126, 702.94, 702.75): granted improvise, hideaway's free play of the exiled card
  ['zz-fast5x/e27.json', fast5xE27], // E27 (path order: e27 sorts after e24, before e3): emblems from planeswalkers (CR 114) and keyword costs II: ward and equip with non-mana and 'or' costs (CR 702.21a, 702.6a, 118.12), devour land (CR 702.82b), typecycling by any subtype (CR 702.29e)
  ['zz-fast5x/e28.json', fast5xE28], // E28 (path order: e28 sorts after e24, before e3): forage and exert as effects (CR 701.61a, 701.43a); keywords persist, undying, riot, decayed, battle cry and extort are keyword data
  // E29 sorts here (path order: 'e29' after 'e24', before 'e3')
  ['zz-fast5x/e29.json', fast5xE29], // E29: impulse-draw permissions (CR 611.2, 601.3, 305.1, 400.7): "until the end of your next turn", "until your next end step", "for as long as it remains exiled", "from exile"
  ['zz-fast5x/e3.json', fast5xE3], // E3: saddle and the saddled designation (CR 702.171): attacks while saddled, becomes saddled, crew and saddle power statics
  ['zz-fast5x/e3xp.json', fast5xE3xp], // E3XP (path order: e3xp sorts after e3, before e4): the cards only the local FAST5X E30-E32 and M12F branches made full, on main's mechanisms: "you may choose new targets for it" (CR 115.7d)
  ['zz-fast5x/e4.json', fast5xE4], // E4: speed (start your engines!, max speed): "where X is" anthems and cost reductions, damage to each player without max speed, searches for up to X
  ['zz-fast5x/e6.json', fast5xE6], // E6: plot, mayhem and harmonize (CR 702.170, 702.187, 702.180): "when ~ becomes plotted" (the keyword lines are kw.line)
  ['zz-fast5x/e7.json', fast5xE7], // E7: sneak and web-slinging (CR 702.190, 702.188): "if ~'s sneak cost was paid, they enter tapped and attacking"
  ['zz-fast5x/e8.json', fast5xE8], // E8: Rooms (CR 709.5): when you unlock this door, whenever you fully unlock a Room, unlock doors, mana for unlock costs
  ['zz-fast5x/e9.json', fast5xE9], // E9: blight (CR 701.68) as an effect; mobilize, job select, increment are keyword data; history statics read by statics/match.ts
  ['zz-fast5x/gy1.json', fast5xGy1], // GY1 (path order: gy1 sorts after e9): "You may play lands from your graveyard" as a static ability (CR 305.1, 305.2, 305.9, 116.2a)
  // Milestone 11 (m11 design 8, M11-4): the commander-card templates under zz-m11/ (path order: after zz-fast*/, before zz-m6/ ('zz-m1' sorts before 'zz-m6'))
  ['zz-m11/cmdf.json', m11Cmdf], // CMDF: "for each time you've cast your / a commander from the command zone this game" tokens, pumps, anthems, enters-with counters, cost reductions (CR 903.8)
  ['zz-m11/commander.json', m11Commander], // M11-4: commander color identity mana, commander casts, your commander from the command zone (CR 903)
  // Milestone 12 (m12 design 9, M12-3): the multiplayer-card templates under zz-m12/ (path order: after zz-m11/, before zz-m6/ ('zz-m12' sorts before 'zz-m6'))
  ['zz-m12/goad.json', m12Goad], // M12-3: goad (CR 701.15), "a goaded creature"
  ['zz-m12/players.json', m12Players], // M12-3: "the player to your left / right gains control of" (CR 101.4, 103.1; m12 design D6)
  ['zz-m12/vote.json', m12Vote], // M12-3: votes for words and objects, additional votes (CR 701.38)
  // Milestone 6 (m6 design 4.2): one file per package under zz-m6/ (path order: after zz-fast*/, before zz-push/)
  ['zz-m6/copy.json', zzM6Copy], // M6-2: token copies with exceptions (CR 707.9b)
  ['zz-m6/costs.json', m6Costs], // M6-5: additional and alternative costs (kicker and/or, grouped costs, kicked counts, escape)
  ['zz-m6/dfc.json', m6Dfc], // M6-4: transform triggers and the double-faced shapes of family D (m6 design 3.6)
  ['zz-m6/face.json', m6Face], // M6-3: manifest, cloak, manifest dread, turning face up / down, "as ~ is turned face up"
  ['zz-m6/gate.json', m6Gate], // M6-10: the acceptance cards' remaining copy, replacement and layout shapes (m6 design 5 "M6-10", 6)
  ['zz-m6/layouts.json', m6Layouts], // M6-6: "enters prepared", "becomes prepared / unprepared", "when ~ becomes level N" (CR 722.3, 716.2a)
  ['zz-m6/merge.json', m6Merge], // M6-9: "whenever this creature mutates" (CR 702.140d)
  ['zz-m6/replace.json', m6Replace], // M6-1: replacement shapes of family R (m6 design 8.3, docs/coverage/m6-head-shapes.txt)
  ['zz-m6/requirements.json', m6Requirements], // M6-7: attack and block requirements (CR 508.1d, 509.1c)
  ['zz-m6/text.json', m6Text], // M6-8: text-changing effects (CR 612): one color word, basic land type or creature type with another
  ['zz-m6/triggers.json', m6Triggers], // M6-12: "If <a permanent> entering causes a triggered ability ... to trigger, that ability triggers an additional time" (CR 603.2d)
  // PUSH1 (docs/ROADMAP.md): one file per coverage-push package under zz-push/, loaded last so packages never edit the same template file
  ['zz-push/k1.json', zzPushK1], // M6-5a (push wave package K1): alternative costs; zz-push/ loads last (m6 design 4.2)
  ['zz-push/t1.json', pushT1],
  ['zz-push/t2.json', pushT2],
  ['zz-push/t3.json', pushT3],
] as [string, unknown][]).map(([file, templates]) => Object.freeze({ file, templates: Object.freeze(templates as Template[]) })));

/** Every committed template, in path order: what the default compiler parses with. */
export const TEMPLATE_SET: readonly Template[] = Object.freeze(TEMPLATE_FILES.flatMap((f) => f.templates));
