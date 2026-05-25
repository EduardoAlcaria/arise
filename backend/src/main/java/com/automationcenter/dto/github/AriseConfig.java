package com.automationcenter.dto.github;

import java.util.List;

public record AriseConfig(
        String compose,
        Integer port,
        List<String> env,
        String name,
        String branch
) {}
