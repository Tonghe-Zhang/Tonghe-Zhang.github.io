---
layout: archive
title: "Research"
permalink: /research/
author_profile: true
---

* Reinforcement learning: theory and algorithm.

In this study, we introduce a novel formulation of **risk-sensitive RL** in a **partially observable** environment with hindsight observations.
We provide the first provably sample-efficient algorithm tailored for the new setting,
whose regret improves existing upper bounds and nearly reaches the lower bounds in the degenerated cases.
Our analysis also explains how the sample complexity is affected by the risk-awareness and history-dependency inherent in our problem.
We validate the theoretical findings through numerical experiments, which demonstrates the algorithm’s capability in solving POMDP problems across various levels of risk sensitivity. We summarized our findings in [the paper](https://tonghe-zhang.github.io/files/risk-pomdp-2024-ICML-camera.pdf) accepted by ICML 2024. 
Our codes are available at [the github repository](https://github.com/Tonghe-Zhang/Beta-vector-value-iteration). 

<!-- 

{% if site.author.googlescholar %}
  <div class="wordwrap">You can also find my articles on <a href="{{site.author.googlescholar}}">my Google Scholar profile</a>.</div>
{% endif %}

{% include base_path %}

{% for post in site.research reversed %}
  {% include archive-single.html %}
{% endfor %} -->
