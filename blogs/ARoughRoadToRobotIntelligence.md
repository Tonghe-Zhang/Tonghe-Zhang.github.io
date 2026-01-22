

I am writing a note to record the common pitfalls of training a robotic policy to solve challenging tasks in real world. 

This will be a technical diary that records the bugs I met during research, and also some retrospections and take-aways. 

I hope that by writing this blog, fewer people, if any, will make the same mistake as I did. 

I will also include some random philosophical thoughts on robot intelligence in general. 

Let's buckle up and set out on a rough road to general robot intelligence. 


January 22nd, 2025

Over the pas two days I have been struggling to deploy Pi05 policy on a 4-YAM teleoperation hardware suite. As a newbie in deploying manipulation policies in the real-world, I did not know what the best hyperparameters should be. So I consulted Grok, Claude Opus4.5, Gemini 3 Pro for advice, and eventually came up with a hyperparameter suite that actually didn't work well in real world.  Anyways, I got stuck for a whole day and the major headache is that the first action of my Pi05 policy is super far away from the grippers, and the subsequent action frames impels the grippers to move to somewhere out-of-reach. This is ridiculous. I thought that there could be several issues: 

1. The fine-tuned checkpoint did not converge, or overfitted.
   Which is actually false. The loss goes down to 5e-3 after 8k steps. In WandB log scale, the curve looks good.
2. The evaluation codebase is wrong (highly possible)
3. The fine-tuning hyperparameter setting is not good enough.

So I spend extra money to let OpenAI Codex help me debug. Unfortunately, that wasted my whole day and gave me shitty code that I cann't parse. So the next day I get quite furious and decided to throw away everything the AI said, and get back to the good-old-fashioned debugging:  print logs and comparing with oracles.

What I did the next day include:

1. Check training bugs. I loaded the policy in my training machine and add code to load my last checkpoint, print the velocity loss, action reconstruction loss on the dataset (in l1 and l2 norm). I discovered that the l1/l2 losses are huge. After consulting GPT I discovered that I did not normalized over the batch of data, so after that the loss gets down to like 1e-3 level. So does my velocity loss. This means the policy did converged on training dataset.
2. Then is the training data correct? I was forced to write a evaluation script on the deployment machine, to replay my dataset actions in sim then in real. It worked quite well. So, since my training convered on real data, and my real data is correct, what happened?
3. I then thoroughly checked all the inference code, and discovered that PI did not provide a perfect codebase that streamlines their monstrous normalization pipeline. I decided to be less ambitious. I started from something that worked, my training script. I simplified it to a minimal codebase that loads and builds policy successfully, and migrated it to my eval machine. However, it causes OOM when I do the eval on eval machine to test if model fits the training dataset, and then after deleting some local variables each step, it worked on eval machine.
4. Then I thoroughly inspected normalization pipeline, just as I thought everything should work, the real eval failed again. I was devastated.
5. Then I decided to print out my actions. It suddenly dawn on me that the actions are way different from my training performance, which matches the dataset. Another thing is that when I compute the reconstruction loss on the train set, I did not use output normalization, and it fits on train set. This is wierd to me. So after canceling output normalization too for the eval script, magic happended. The first action chunk becomes near to the gripper, and robot starts picking up the tshirt. This is crazy. I then inspected the robot dataset, and found out that the normalized state/actionns do not have a zero mean, so my dataset was wrong in the first place! It was never actually normalized.

Some key-takeaways: 

1. During training, periodically log more stuffs, don't just log your loss. Also add action reconstruction (in l1/l2).
2. Pay the highest attention on your data. Inspect data files your self, try to memorize the normalization statistics on each robot joint. Then when you debug, you can even read the output actions to find where is wrong.
3. Add sanity check after letting AI writing code. Til now they never fully solve problems and you must be the final verifier. After normalization, you should quickly fetch a batch of data and compute its per-sample mean to see if it has zero mean (if you use mean/std normalizaiton). Printing out the data min/max distributions are also a great idea if you use other normalizaitons. Also dig into your data in your dataset and during model passes.
4. Invest more time in building a debugger on your deploy machine and during training. Use more visualization for your images, and print out the statistics of your state/actions. These tools will save you in the end.
5. If you're using server-client communication but the visualization tools have invalid address, check the "Ports" window of you IDE to see if the post got transfered to other ids.
6. I never recognized that action jerkiness is such a great problem, until I deployed my model on real robots. Spend less time in simulation-only research, spend more time on-board.
